/**
 * キャンバス UI。**素の web として書く**（`vscode` にも `acquireVsCodeApi` にも触らない）。
 *
 * ## この層は判断を持たない（design DD3）
 *
 * 表示桁の換算・検証・配置はすべて `dds-core` が済ませて `RenderModel` に載っている。
 * ここにあるのは **「セル座標 ⇄ ピクセル」の線形変換だけ**で、これは文字に依存しない。
 * 幅は `segments[].cols × セル幅` で決まり、**UI が文字を数えることはない**。
 *
 * ## 楽観更新をしない（design「WebView の状態遷移」）
 *
 * ドラッグ中の**見た目**だけは即時に追従させるが、モデルは触らない。
 * 確定は `patch` → ホスト → `applied` の往復後。`Pending` 中は追加の編集を受け付けない。
 * **core の判定が唯一の正**なので、UI が「たぶんこうなる」を先に描くと二重の真実になる。
 */

import type { PatchOp, RenderItem, RenderModel } from "@as400/dds-core";
import type { Bridge } from "./bridge";
import {
  cellFromOffset,
  clamp,
  movedTo,
  resizedTo,
  type CanvasSize,
  type CellPoint
} from "./geometry";
import type { Host, HostMessage } from "./protocol";

/** これ以上動いたらドラッグとみなす（クリックとの区別）。 */
const DRAG_THRESHOLD_PX = 3;
/** セル幅の測定に使う文字数。1 文字だと丸め誤差が乗る。 */
const MEASURE_SAMPLE = 80;

/** ホストが未接続のときの既定（スタンドアロン基準・design DD7）。 */
const DEFAULT_HOST: Host = {
  name: "standalone",
  providesFileIO: false,
  providesUndo: false,
  providesCommandPalette: false,
  canOpenTextEditor: false,
  hasPrompter: false
};

type Mode = "idle" | "selecting" | "dragging" | "resizing" | "pending";

interface Gesture {
  readonly id: string;
  readonly startX: number;
  readonly startY: number;
  readonly originLine: number;
  readonly originPos: number;
  readonly originWidth: number;
  readonly element: HTMLElement;
}

/** 追加操作で待ち受けている種別。`null` なら待ち受けていない。 */
type Placing = "field" | "constant" | null;

/** UI を起動する。ホストとの通信路は `bridge` から与えられる。 */
export function startEditor(bridge: Bridge, root: HTMLElement): void {
  const view = new EditorView(bridge, root);
  bridge.onMessage(message => view.handle(message));
  bridge.post({ type: "ready" });
}

class EditorView {
  private readonly bridge: Bridge;
  private host: Host = DEFAULT_HOST;
  private model: RenderModel | undefined;
  private mode: Mode = "idle";
  private selectedId: string | undefined;
  private gesture: Gesture | undefined;
  private placing: Placing = null;
  /** 送信中のパッチ。構造を変える操作かどうかの判定に使う。 */
  private pendingOp: PatchOp | undefined;
  private cellW = 8;
  private cellH = 18;

  private readonly frame: HTMLElement;
  private readonly ruler: HTMLElement;
  private readonly gutter: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly diagnostics: HTMLElement;
  private readonly recordName: HTMLElement;
  private readonly status: HTMLElement;
  private readonly metrics: HTMLElement;
  private readonly fieldName: HTMLInputElement;
  private readonly fieldLength: HTMLInputElement;
  private readonly constantText: HTMLInputElement;
  private readonly addFieldButton: HTMLButtonElement;
  private readonly addConstantButton: HTMLButtonElement;

  constructor(bridge: Bridge, root: HTMLElement) {
    this.bridge = bridge;

    root.innerHTML = template();
    this.frame = must(root, ".dds-frame");
    this.ruler = must(root, ".dds-ruler");
    this.gutter = must(root, ".dds-gutter");
    this.canvas = must(root, ".dds-canvas");
    this.diagnostics = must(root, ".dds-diagnostics");
    this.recordName = must(root, ".record-name");
    this.status = must(root, ".status");
    this.metrics = must(root, ".dds-metrics");
    this.fieldName = must(root, "#dds-field-name");
    this.fieldLength = must(root, "#dds-field-length");
    this.constantText = must(root, "#dds-constant-text");
    this.addFieldButton = must(root, "#dds-add-field");
    this.addConstantButton = must(root, "#dds-add-constant");

    this.measure();
    // **フォントは後から届くことがある。** 先に測ると代替フォントの幅で全桁がずれるので、
    // 読み込み完了とウィンドウ変化のたびに測り直す（design DD2）。
    document.fonts?.ready.then(() => this.measure());
    window.addEventListener("resize", () => this.measure());

    this.canvas.addEventListener("pointerdown", event => this.onPointerDown(event));
    document.addEventListener("pointermove", event => this.onPointerMove(event));
    document.addEventListener("pointerup", event => this.onPointerUp(event));
    document.addEventListener("keydown", event => this.onKeyDown(event));
    this.addFieldButton.addEventListener("click", () => this.arm("field"));
    this.addConstantButton.addEventListener("click", () => this.arm("constant"));
  }

  /** ホストからのメッセージ。**唯一の状態更新の入口。** */
  handle(message: HostMessage): void {
    switch (message.type) {
      case "load":
        this.host = message.host;
        this.model = message.model;
        this.mode = "idle";
        this.setStatus("");
        this.render();
        break;
      case "applied":
        this.model = message.model;
        this.mode = "idle";
        this.gesture = undefined;
        // **構造を変えた後は選択を捨てる。** ID は再パースで振り直されるので
        // （04 decisions D3・実測: 削除すると後続の番号が詰まる）、
        // 同じ ID を持ち続けると**別のアイテムを選んでいる**ことになる。
        // そのまま Delete を押すと、選んだつもりのない項目が消える（review should-2）。
        if (isStructural(this.pendingOp)) {
          this.selectedId = undefined;
        }
        this.pendingOp = undefined;
        this.setStatus("");
        this.render();
        break;
      case "rejected":
        // 元の位置は UI が覚えずホストのモデルから描き直す（状態を 2 か所に置かない）。
        this.model = message.model;
        this.mode = "idle";
        this.gesture = undefined;
        this.pendingOp = undefined;
        this.setStatus(message.reason);
        this.render();
        break;
    }
  }

  // ---- 計測 --------------------------------------------------------

  /**
   * セルの実寸を測る（design DD2）。
   *
   * CSS の `ch` は「`0` の文字送り幅」であって、日本語混在の等幅フォントで
   * DBCS 幅と一致する保証がない。**測定を誤ると全桁がずれる**ので、測った値は必ず画面に出す。
   */
  private measure(): void {
    const sample = document.createElement("span");
    sample.className = "dds-measure";
    sample.textContent = "0".repeat(MEASURE_SAMPLE);
    this.frame.appendChild(sample);
    const rect = sample.getBoundingClientRect();
    sample.remove();

    if (rect.width <= 0 || rect.height <= 0) {
      return; // 非表示のとき等。前の値を保つ。
    }

    this.cellW = rect.width / MEASURE_SAMPLE;
    this.cellH = rect.height;
    this.frame.style.setProperty("--cell-w", `${this.cellW}px`);
    this.frame.style.setProperty("--cell-h", `${this.cellH}px`);
    this.metrics.textContent =
      `セル ${this.cellW.toFixed(2)}×${this.cellH.toFixed(2)}px`;
    this.render();
  }

  // ---- 描画 --------------------------------------------------------

  private render(): void {
    const model = this.model;
    if (model === undefined) {
      return;
    }

    this.frame.style.setProperty("--cols", String(model.canvas.cols));
    this.frame.style.setProperty("--rows", String(model.canvas.rows));
    this.metrics.textContent =
      `セル ${this.cellW.toFixed(2)}×${this.cellH.toFixed(2)}px` +
      ` / ${model.canvas.rows}×${model.canvas.cols}`;

    const record = model.records[0];
    this.recordName.textContent =
      record === undefined ? "（様式なし）" : `様式 ${record.name}`;

    this.renderRuler(model.canvas.cols);
    this.renderGutter(model.canvas.rows);
    this.renderItems(record?.items ?? []);
    this.renderDiagnostics(model);

    const empty = record === undefined || record.items.length === 0;
    this.addFieldButton.disabled = record === undefined;
    this.addConstantButton.disabled = record === undefined;
    if (empty && this.status.textContent === "") {
      this.setStatus(
        record === undefined
          ? "編集可能な項目がありません（レコード様式が見つかりません）"
          : "編集可能な項目がありません"
      );
    }
  }

  // **位置は必ず CSSOM（`element.style.*`）で与える。**
  // HTML の `style="..."` 属性は WebView の CSP（`style-src` に `unsafe-inline` を入れていない）で
  // 落ちる——落ちても例外は出ず、**桁だけが静かにずれる**。最も気付きにくい壊れ方なので、
  // ここは文字列の HTML を組み立てない。
  private renderRuler(cols: number): void {
    const labels: HTMLElement[] = [];
    const first = document.createElement("span");
    first.textContent = "1";
    first.style.left = "0";
    labels.push(first);

    for (let col = 10; col <= cols; col += 10) {
      const label = String(col);
      const span = document.createElement("span");
      span.textContent = label;
      // ラベルの右端をその桁の右端に合わせる（SEU のルーラーと同じ読み方）。
      span.style.left = `calc(var(--cell-w) * ${col - label.length})`;
      labels.push(span);
    }

    this.ruler.replaceChildren(...labels);
  }

  private renderGutter(rows: number): void {
    const cells: HTMLElement[] = [];
    for (let row = 1; row <= rows; row += 1) {
      const cell = document.createElement("div");
      cell.textContent = String(row).padStart(2, " ");
      cell.style.height = "var(--cell-h)";
      cells.push(cell);
    }
    this.gutter.replaceChildren(...cells);
  }

  private renderItems(items: readonly RenderItem[]): void {
    this.canvas.replaceChildren();
    for (const item of items) {
      this.canvas.appendChild(this.buildItem(item));
    }
  }

  private buildItem(item: RenderItem): HTMLElement {
    const element = document.createElement("div");
    element.className = `dds-item ${item.kind}`;
    element.dataset.id = item.id;
    element.dataset.line = String(item.line);
    element.dataset.pos = String(item.pos);
    element.dataset.width = String(item.widthCols);
    element.dataset.sourceLine = String(item.sourceLine);
    element.style.left = `calc(var(--cell-w) * ${item.pos - 1})`;
    element.style.top = `calc(var(--cell-h) * ${item.line - 1})`;
    element.style.width = `calc(var(--cell-w) * ${item.widthCols})`;
    element.title =
      `${item.id}（${item.kind === "field" ? "フィールド" : "定数"}）` +
      ` 行 ${item.line} 桁 ${item.pos} 幅 ${item.widthCols}`;

    // **区切りは core が決めている。** ここでは cols × セル幅の箱に流すだけ（DD3）。
    for (const segment of item.segments) {
      const span = document.createElement("span");
      span.className = "seg";
      span.style.width = `calc(var(--cell-w) * ${segment.cols})`;
      span.textContent = segment.text;
      element.appendChild(span);
    }

    if (item.id === this.selectedId) {
      element.classList.add("selected");
      if (item.kind === "field") {
        const handle = document.createElement("span");
        handle.className = "handle";
        handle.dataset.role = "resize";
        element.appendChild(handle);
      }
    }

    return element;
  }

  private renderDiagnostics(model: RenderModel): void {
    if (model.diagnostics.length === 0) {
      this.diagnostics.innerHTML = `<div class="none">検証: 問題なし</div>`;
      return;
    }

    const list = document.createElement("ul");
    for (const diagnostic of model.diagnostics) {
      const row = document.createElement("li");
      row.className = diagnostic.severity;
      const jumpable =
        this.host.canOpenTextEditor && diagnostic.sourceLine !== undefined;
      if (jumpable) {
        row.classList.add("jumpable");
        row.addEventListener("click", () =>
          this.bridge.post({
            type: "openSource",
            sourceLine: diagnostic.sourceLine as number
          })
        );
      }
      // **どのアイテムの話かを必ず出す。** 同じ文言の診断が複数並ぶことがあり
      // （例: 小数桁が無い数値フィールドが 2 つ）、対象が分からないと直しようがない。
      row.append(
        span("mark", diagnostic.severity === "error" ? "✖" : "▲"),
        span("code", diagnostic.code),
        span("target", diagnostic.itemId ?? ""),
        span("message", diagnostic.message)
      );
      list.appendChild(row);

      const flagged =
        diagnostic.itemId === undefined
          ? null
          : this.canvas.querySelector<HTMLElement>(
              `[data-id="${cssEscape(diagnostic.itemId)}"]`
            );
      flagged?.classList.add(
        diagnostic.severity === "error" ? "flagged-error" : "flagged"
      );
    }

    this.diagnostics.replaceChildren(list);
  }

  // ---- 操作 --------------------------------------------------------

  private onPointerDown(event: PointerEvent): void {
    if (this.placing !== null) {
      this.place(event);
      return;
    }
    // **Pending 中は受け付けない**（往復の途中で次の編集を積まない）。
    if (this.mode === "pending") {
      return;
    }

    const target = event.target as HTMLElement | null;
    const element = target?.closest<HTMLElement>(".dds-item") ?? null;
    if (element === null) {
      this.select(undefined);
      return;
    }

    const id = element.dataset.id;
    if (id === undefined) {
      return;
    }
    this.select(id);

    // **選択は再描画を伴うので、掴む要素は描き直した後に取り直す。**
    // ここで `element`（pointerdown 時の要素）を握ると、既に DOM から外れた要素を
    // 動かすことになり、ドラッグ中の見た目が一切追従しない。
    const current =
      this.canvas.querySelector<HTMLElement>(
        `[data-id="${cssEscape(id)}"]`
      ) ?? element;

    this.gesture = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      originLine: Number(current.dataset.line),
      originPos: Number(current.dataset.pos),
      originWidth: Number(current.dataset.width),
      element: current
    };
    this.mode = target?.dataset.role === "resize" ? "resizing" : "selecting";
    event.preventDefault();
  }

  private onPointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (gesture === undefined) {
      return;
    }

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;

    if (this.mode === "selecting") {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
        return;
      }
      this.mode = "dragging";
      gesture.element.classList.add("dragging");
    }

    if (this.mode === "dragging") {
      // 見た目だけ追従させる。モデルは触らない（楽観更新をしない）。
      const target = this.dragTarget(gesture, dx, dy);
      gesture.element.style.left = `calc(var(--cell-w) * ${target.pos - 1})`;
      gesture.element.style.top = `calc(var(--cell-h) * ${target.line - 1})`;
      return;
    }

    if (this.mode === "resizing") {
      const width = this.resizeTarget(gesture, dx);
      gesture.element.style.width = `calc(var(--cell-w) * ${width})`;
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (gesture === undefined) {
      return;
    }

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;

    if (this.mode === "dragging") {
      const target = this.dragTarget(gesture, dx, dy);
      gesture.element.classList.remove("dragging");
      if (target.line === gesture.originLine && target.pos === gesture.originPos) {
        this.mode = "idle";
        this.gesture = undefined;
        return;
      }
      this.send({
        op: "moveItem",
        id: gesture.id,
        line: target.line,
        pos: target.pos
      });
      return;
    }

    if (this.mode === "resizing") {
      const width = this.resizeTarget(gesture, dx);
      if (width === gesture.originWidth) {
        this.mode = "idle";
        this.gesture = undefined;
        this.render();
        return;
      }
      this.send({ op: "resizeItem", id: gesture.id, length: width });
      return;
    }

    this.mode = "idle";
    this.gesture = undefined;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.mode !== "idle" || this.selectedId === undefined) {
      return;
    }
    if (isTypingTarget(event.target)) {
      return; // ツールバーの入力中は横取りしない。
    }

    const selected = this.selectedItem();
    if (selected === undefined) {
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.send({ op: "removeItem", id: selected.id });
      return;
    }

    const step = arrowStep(event.key);
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    const canvas = this.model?.canvas;
    if (canvas === undefined) {
      return;
    }
    // 1 桁ずつの移動。ドラッグでは出しにくい「あと 1 桁」をキーボードで詰める。
    this.send({
      op: "moveItem",
      id: selected.id,
      line: clamp(selected.line + step.line, 1, canvas.rows),
      pos: clamp(selected.pos + step.pos, 1, canvas.cols)
    });
  }

  /** 追加を待ち受ける（次のキャンバスクリックで置く）。 */
  private arm(kind: Exclude<Placing, null>): void {
    this.placing = this.placing === kind ? null : kind;
    this.addFieldButton.classList.toggle("armed", this.placing === "field");
    this.addConstantButton.classList.toggle("armed", this.placing === "constant");
    this.canvas.classList.toggle("placing", this.placing !== null);
    this.setStatus(
      this.placing === null ? "" : "キャンバスをクリックすると配置します"
    );
  }

  private place(event: PointerEvent): void {
    const kind = this.placing;
    const record = this.model?.records[0];
    if (kind === null || record === undefined) {
      return;
    }
    const cell = this.cellAt(event);

    if (kind === "field") {
      const name = this.fieldName.value.trim().toUpperCase();
      const length = Number(this.fieldLength.value);
      if (name === "" || !Number.isInteger(length) || length < 1) {
        this.setStatus("フィールド名と長さを入力してください");
        return;
      }
      this.arm("field"); // 解除
      this.send({
        op: "addItem",
        record: record.name,
        item: {
          kind: "field",
          name,
          length,
          dataType: "A",
          usage: "B",
          line: cell.line,
          pos: cell.pos
        }
      });
      return;
    }

    const text = this.constantText.value;
    if (text === "") {
      this.setStatus("定数の文字列を入力してください");
      return;
    }
    this.arm("constant"); // 解除
    this.send({
      op: "addItem",
      record: record.name,
      item: { kind: "constant", text, line: cell.line, pos: cell.pos }
    });
  }

  // ---- 補助 --------------------------------------------------------

  /** パッチを送り、往復が終わるまで `Pending` にする。 */
  private send(op: PatchOp): void {
    this.mode = "pending";
    this.pendingOp = op;
    this.setStatus("適用中…");
    this.bridge.post({ type: "patch", ops: [op] });
  }

  private select(id: string | undefined): void {
    if (this.selectedId === id) {
      return;
    }
    this.selectedId = id;
    this.render();
  }

  private selectedItem(): RenderItem | undefined {
    return this.model?.records[0]?.items.find(
      item => item.id === this.selectedId
    );
  }

  // 以下 3 つは `geometry` の純関数に渡すだけ。**計算は UI に置かない**（単体で守るため）。

  private dragTarget(gesture: Gesture, dx: number, dy: number): CellPoint {
    return movedTo(
      { line: gesture.originLine, pos: gesture.originPos },
      dx,
      dy,
      gesture.originWidth,
      this.metricsOf(),
      this.canvasSize()
    );
  }

  private resizeTarget(gesture: Gesture, dx: number): number {
    return resizedTo(
      gesture.originWidth,
      gesture.originPos,
      dx,
      this.metricsOf(),
      this.canvasSize()
    );
  }

  private cellAt(event: PointerEvent): CellPoint {
    const rect = this.canvas.getBoundingClientRect();
    return cellFromOffset(
      event.clientX - rect.left,
      event.clientY - rect.top,
      this.metricsOf(),
      this.canvasSize()
    );
  }

  private metricsOf(): { cellW: number; cellH: number } {
    return { cellW: this.cellW, cellH: this.cellH };
  }

  private canvasSize(): CanvasSize {
    return this.model?.canvas ?? { rows: 24, cols: 80 };
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
  }
}

function template(): string {
  return `
<div class="dds-app">
  <div class="dds-toolbar">
    <span class="record-name"></span>
    <span class="group">
      <label for="dds-field-name">名前</label>
      <input id="dds-field-name" size="10" maxlength="10" value="FLD1">
      <label for="dds-field-length">長さ</label>
      <input id="dds-field-length" size="3" value="10">
      <button id="dds-add-field" type="button">フィールド追加</button>
    </span>
    <span class="group">
      <label for="dds-constant-text">定数</label>
      <input id="dds-constant-text" size="16" value="TEXT">
      <button id="dds-add-constant" type="button">定数追加</button>
    </span>
    <span class="spacer"></span>
    <span class="status"></span>
    <span class="dds-metrics"></span>
  </div>
  <div class="dds-main">
    <div class="dds-frame">
      <div class="dds-ruler"></div>
      <div class="dds-body">
        <div class="dds-gutter"></div>
        <div class="dds-canvas"></div>
      </div>
    </div>
  </div>
  <div class="dds-diagnostics"></div>
</div>`;
}

/** アイテムの増減を伴う操作か。ID の振り直しが起きるのはこの 2 つ。 */
function isStructural(op: PatchOp | undefined): boolean {
  return op?.op === "addItem" || op?.op === "removeItem";
}

function span(className: string, text: string): HTMLElement {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
}

function must<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`UI の要素が見つかりません: ${selector}`);
  }
  return element;
}

function arrowStep(key: string): { line: number; pos: number } | undefined {
  switch (key) {
    case "ArrowLeft":
      return { line: 0, pos: -1 };
    case "ArrowRight":
      return { line: 0, pos: 1 };
    case "ArrowUp":
      return { line: -1, pos: 0 };
    case "ArrowDown":
      return { line: 1, pos: 0 };
    default:
      return undefined;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement;
}

/** 属性セレクタに埋める値のエスケープ。`CSS.escape` が無い環境向けの保険付き。 */
function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}
