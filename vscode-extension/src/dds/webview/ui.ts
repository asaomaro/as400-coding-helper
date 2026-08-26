import type { DdsEdit } from "../../core/dds/ddsEdit";
import type { RenderItem, RenderModel } from "../../core/dds/dspfRenderModel";
import type { Bridge } from "./bridge";
import {
  cellFromOffset,
  clamp,
  movedTo,
  resizedTo,
  type CanvasSize,
  type CellMetrics,
  type CellPoint
} from "./geometry";
import { STANDALONE_HOST, type EditorHost } from "./protocol";

/**
 * DDS エディタのキャンバス UI。**素の web として書く**（`vscode` にも `acquireVsCodeApi` にも触らない）。
 *
 * ## この層は判断を持たない
 *
 * 桁・幅・重なりはすべて core が決めて `RenderModel` に載っている。ここにあるのは
 * **「セル座標 ⇄ ピクセル」の線形変換だけ**で、これは文字に依存しない。
 * 幅は `segments[].cols × セル幅` で決まり、**UI が文字を数えることはない**。
 *
 * ## 楽観更新をしない
 *
 * ドラッグ中の**見た目**だけは即時に追従させるが、モデルは触らない。確定は
 * `edit` → ホスト → `applied` の往復後。**core の判定が唯一の正**なので、
 * UI が「たぶんこうなる」を先に描くと真実が 2 つになる。
 */

const DRAG_THRESHOLD_PX = 3;
const MEASURE_SAMPLE = 80;

type Mode = "idle" | "selecting" | "dragging" | "resizing" | "pending";
type Placing = "field" | "constant" | null;

interface Gesture {
  readonly sourceLine: number;
  readonly startX: number;
  readonly startY: number;
  readonly origin: CellPoint;
  readonly widthCols: number;
  readonly element: HTMLElement;
}

/** 追加の内容をホストに聞く（ホストが入力手段を持つ）。 */
export type AskItem = (
  kind: "field" | "constant",
  at: CellPoint
) => Promise<Record<string, unknown> | undefined>;

export interface EditorOptions {
  /** 追加の内容を聞く手段。省略すると「追加」は使えない。 */
  readonly askItem?: AskItem;
}

export function startEditor(
  bridge: Bridge,
  root: HTMLElement,
  options: EditorOptions = {}
): void {
  const view = new EditorView(bridge, root, options);
  bridge.onMessage(message => view.handle(message));
  bridge.post({ type: "ready" });
}

class EditorView {
  private host: EditorHost = STANDALONE_HOST;
  private model: RenderModel | undefined;
  private mode: Mode = "idle";
  private selected: number | undefined;
  private gesture: Gesture | undefined;
  private placing: Placing = null;
  private pendingStructural = false;
  private cellWidth = 8;
  private lineHeight = 18;

  private readonly frame: HTMLElement;
  private readonly ruler: HTMLElement;
  private readonly gutter: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly diagnostics: HTMLElement;
  private readonly status: HTMLElement;
  private readonly metrics: HTMLElement;
  private readonly title: HTMLElement;
  private readonly addField: HTMLButtonElement;
  private readonly addConstant: HTMLButtonElement;

  constructor(
    private readonly bridge: Bridge,
    root: HTMLElement,
    private readonly options: EditorOptions
  ) {
    root.innerHTML = template();
    this.frame = must(root, ".dds-frame");
    this.ruler = must(root, ".dds-ruler");
    this.gutter = must(root, ".dds-gutter");
    this.canvas = must(root, ".dds-canvas");
    this.diagnostics = must(root, ".dds-diagnostics");
    this.status = must(root, ".status");
    this.metrics = must(root, ".dds-metrics");
    this.title = must(root, ".record-name");
    this.addField = must(root, "#dds-add-field");
    this.addConstant = must(root, "#dds-add-constant");

    this.measure();
    // **フォントは後から届くことがある。** 先に測ると代替フォントの幅で全桁がずれる。
    document.fonts?.ready.then(() => this.measure());
    window.addEventListener("resize", () => this.measure());

    this.canvas.addEventListener("pointerdown", event => this.onPointerDown(event));
    document.addEventListener("pointermove", event => this.onPointerMove(event));
    document.addEventListener("pointerup", event => this.onPointerUp(event));
    document.addEventListener("keydown", event => this.onKeyDown(event));
    this.addField.addEventListener("click", () => this.arm("field"));
    this.addConstant.addEventListener("click", () => this.arm("constant"));
  }

  handle(message: { type: string; [key: string]: unknown }): void {
    switch (message.type) {
      case "load":
        this.host = message.host as EditorHost;
        this.model = message.model as RenderModel;
        this.mode = "idle";
        this.setStatus("");
        this.render();
        break;
      case "applied":
        this.model = message.model as RenderModel;
        this.mode = "idle";
        this.gesture = undefined;
        // 構造を変えたあとは選択を捨てる。宛先の行が消えている／ずれている。
        if (this.pendingStructural) this.selected = undefined;
        this.pendingStructural = false;
        this.setStatus("");
        this.render();
        break;
      case "rejected": {
        this.model = message.model as RenderModel;
        this.mode = "idle";
        this.gesture = undefined;
        this.pendingStructural = false;
        const rejections = (message.rejections ?? []) as ReadonlyArray<{ message: string }>;
        // 元の位置は UI が覚えず、ホストのモデルから描き直す（状態を 2 か所に置かない）。
        this.setStatus(rejections.map(rejection => rejection.message).join(" / "));
        this.render();
        break;
      }
    }
  }

  // ---- 計測 --------------------------------------------------------

  private measure(): void {
    const sample = document.createElement("span");
    sample.className = "dds-measure";
    sample.textContent = "0".repeat(MEASURE_SAMPLE);
    this.frame.appendChild(sample);
    const rect = sample.getBoundingClientRect();
    sample.remove();
    if (rect.width <= 0 || rect.height <= 0) return;

    this.cellWidth = rect.width / MEASURE_SAMPLE;
    this.lineHeight = rect.height;
    this.frame.style.setProperty("--cell-w", `${this.cellWidth}px`);
    this.frame.style.setProperty("--cell-h", `${this.lineHeight}px`);
    this.render();
  }

  // ---- 描画 --------------------------------------------------------

  private render(): void {
    const model = this.model;
    if (!model) return;

    this.frame.style.setProperty("--cols", String(model.canvas.columns));
    this.frame.style.setProperty("--rows", String(model.canvas.rows));
    this.metrics.textContent =
      `セル ${this.cellWidth.toFixed(2)}×${this.lineHeight.toFixed(2)}px` +
      ` / ${model.canvas.rows}×${model.canvas.columns}`;
    this.title.textContent =
      model.records.length > 0 ? `様式 ${model.records.join(" / ")}` : "（様式なし）";

    this.renderRuler(model.canvas.columns);
    this.renderGutter(model.canvas.rows);
    this.renderItems(model.items);
    this.renderDiagnostics(model);

    const canAdd = model.records.length > 0 && this.options.askItem !== undefined;
    this.addField.disabled = !canAdd;
    this.addConstant.disabled = !canAdd;
  }

  // **位置は必ず CSSOM（`element.style.*`）で与える。**
  // HTML の `style="…"` 属性は CSP（`style-src` に `unsafe-inline` を入れていない）で落ち、
  // しかも例外は出ず**桁だけが静かにずれる**。
  private renderRuler(columns: number): void {
    const labels: HTMLElement[] = [];
    const first = document.createElement("span");
    first.textContent = "1";
    first.style.left = "0";
    labels.push(first);

    for (let column = 10; column <= columns; column += 10) {
      const label = String(column);
      const span = document.createElement("span");
      span.textContent = label;
      span.style.left = `calc(var(--cell-w) * ${column - label.length})`;
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
    const nodes: HTMLElement[] = [];
    for (const item of items) {
      nodes.push(...attributeMarkers(item));
      nodes.push(this.buildItem(item));
    }
    this.canvas.replaceChildren(...nodes);
  }

  private buildItem(item: RenderItem): HTMLElement {
    const element = document.createElement("div");
    element.className = `dds-item ${item.kind}`;
    if (item.widthCols === undefined) element.classList.add("unknown-width");
    if (item.sourceLine === this.selected) element.classList.add("selected");
    element.dataset.sourceLine = String(item.sourceLine);
    element.dataset.row = String(item.row);
    element.dataset.column = String(item.column);
    element.dataset.width = String(item.widthCols ?? 1);
    element.dataset.resizable = String(item.resizable);
    element.style.left = `calc(var(--cell-w) * ${item.column - 1})`;
    element.style.top = `calc(var(--cell-h) * ${item.row - 1})`;
    element.style.width = `calc(var(--cell-w) * ${item.widthCols ?? 1})`;
    element.title =
      `${item.label}（${item.row} 行 ${item.column} 桁` +
      `${item.widthCols === undefined ? " / 幅不明" : ` / ${item.widthCols} 桁`}` +
      ` / ソース ${item.sourceLine} 行目）`;

    if (item.segments.length === 0) {
      const span = document.createElement("span");
      span.className = "seg";
      span.style.width = "var(--cell-w)";
      span.textContent = "?";
      element.appendChild(span);
    }
    // **区切りは core が決めている。** ここでは cols × セル幅の箱に流すだけ。
    for (const segment of item.segments) {
      const span = document.createElement("span");
      span.className = "seg";
      span.style.width = `calc(var(--cell-w) * ${segment.cols})`;
      span.textContent = segment.text;
      element.appendChild(span);
    }

    if (item.sourceLine === this.selected && item.resizable) {
      const handle = document.createElement("span");
      handle.className = "handle";
      handle.dataset.role = "resize";
      element.appendChild(handle);
    }

    return element;
  }

  private renderDiagnostics(model: RenderModel): void {
    if (model.diagnostics.length === 0) {
      this.diagnostics.replaceChildren(text("div", "none", "検証: 指摘はありません"));
      return;
    }

    const list = document.createElement("ul");
    for (const diagnostic of model.diagnostics) {
      const row = document.createElement("li");
      if (this.host.canOpenSource) {
        row.classList.add("jumpable");
        row.addEventListener("click", () =>
          this.bridge.post({ type: "openSource", sourceLine: diagnostic.sourceLine })
        );
      }
      row.append(
        text("span", "code", diagnostic.code),
        text("span", "line", `${diagnostic.sourceLine} 行目`),
        text("span", "message", diagnostic.message)
      );
      list.appendChild(row);
    }
    this.diagnostics.replaceChildren(list);
  }

  // ---- 操作 --------------------------------------------------------

  private onPointerDown(event: PointerEvent): void {
    if (this.placing !== null) {
      void this.place(event);
      return;
    }
    // **Pending 中は受け付けない**（往復の途中で次の編集を積まない）。
    if (this.mode === "pending") return;

    const target = event.target as HTMLElement | null;
    const element = target?.closest<HTMLElement>(".dds-item") ?? null;
    if (!element) {
      this.select(undefined);
      return;
    }

    const sourceLine = Number(element.dataset.sourceLine);
    this.select(sourceLine);

    // 選択で描き直すので、掴む要素は**描き直した後に取り直す**。
    const current =
      this.canvas.querySelector<HTMLElement>(`[data-source-line="${sourceLine}"]`) ?? element;

    this.gesture = {
      sourceLine,
      startX: event.clientX,
      startY: event.clientY,
      origin: {
        row: Number(current.dataset.row),
        column: Number(current.dataset.column)
      },
      widthCols: Number(current.dataset.width),
      element: current
    };
    this.mode = target?.dataset.role === "resize" ? "resizing" : "selecting";
    event.preventDefault();
  }

  private onPointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;

    if (this.mode === "selecting") {
      if (Math.abs(deltaX) < DRAG_THRESHOLD_PX && Math.abs(deltaY) < DRAG_THRESHOLD_PX) return;
      this.mode = "dragging";
      gesture.element.classList.add("dragging");
    }

    if (this.mode === "dragging") {
      const target = this.dragTarget(gesture, deltaX, deltaY);
      gesture.element.style.left = `calc(var(--cell-w) * ${target.column - 1})`;
      gesture.element.style.top = `calc(var(--cell-h) * ${target.row - 1})`;
      return;
    }

    if (this.mode === "resizing") {
      const width = this.resizeTarget(gesture, deltaX);
      gesture.element.style.width = `calc(var(--cell-w) * ${width})`;
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;

    if (this.mode === "dragging") {
      const target = this.dragTarget(gesture, deltaX, deltaY);
      gesture.element.classList.remove("dragging");
      if (target.row === gesture.origin.row && target.column === gesture.origin.column) {
        this.mode = "idle";
        this.gesture = undefined;
        return;
      }
      this.send({
        kind: "move",
        sourceLine: gesture.sourceLine,
        row: target.row,
        column: target.column
      });
      return;
    }

    if (this.mode === "resizing") {
      const width = this.resizeTarget(gesture, deltaX);
      if (width === gesture.widthCols) {
        this.mode = "idle";
        this.gesture = undefined;
        this.render();
        return;
      }
      this.send({ kind: "resize", sourceLine: gesture.sourceLine, length: width });
      return;
    }

    this.mode = "idle";
    this.gesture = undefined;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      this.placing = null;
      this.updateArmed();
      this.select(undefined);
      this.setStatus("");
      return;
    }
    if (this.mode !== "idle" || this.selected === undefined) return;
    if (isTypingTarget(event.target)) return;

    const item = this.selectedItem();
    if (!item) return;

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.send({ kind: "remove", sourceLine: item.sourceLine });
      return;
    }

    const step = arrowStep(event.key);
    if (!step) return;
    event.preventDefault();
    const canvas = this.canvasSize();
    this.send({
      kind: "move",
      sourceLine: item.sourceLine,
      row: clamp(item.row + step.row, 1, canvas.rows),
      column: clamp(item.column + step.column, 1, canvas.columns)
    });
  }

  private arm(kind: Exclude<Placing, null>): void {
    this.placing = this.placing === kind ? null : kind;
    this.updateArmed();
    this.setStatus(this.placing === null ? "" : "キャンバスをクリックすると置きます（Esc で取り消し）");
  }

  private updateArmed(): void {
    this.addField.classList.toggle("armed", this.placing === "field");
    this.addConstant.classList.toggle("armed", this.placing === "constant");
    this.canvas.classList.toggle("placing", this.placing !== null);
  }

  private async place(event: PointerEvent): Promise<void> {
    const kind = this.placing;
    const ask = this.options.askItem;
    if (kind === null || ask === undefined) return;

    const at = this.cellAt(event);
    const record = this.recordAt(at.row);
    if (record === undefined) return;
    this.placing = null;
    this.updateArmed();

    const item = await ask(kind, at);
    if (item === undefined) {
      this.setStatus(""); // 取り消し。何も置かない。
      return;
    }

    this.pendingStructural = true;
    this.mode = "pending";
    this.setStatus("適用中…");
    this.bridge.post({
      type: "edit",
      edits: [
        {
          kind: "add",
          recordName: record,
          item: { ...item, row: at.row, column: at.column }
        } as DdsEdit
      ]
    });
  }

  // ---- 補助 --------------------------------------------------------

  private send(edit: DdsEdit): void {
    this.mode = "pending";
    this.pendingStructural = edit.kind === "add" || edit.kind === "remove";
    this.setStatus("適用中…");
    this.bridge.post({ type: "edit", edits: [edit] });
  }

  private select(sourceLine: number | undefined): void {
    if (this.selected === sourceLine) return;
    this.selected = sourceLine;
    this.render();
  }

  private selectedItem(): RenderItem | undefined {
    return this.model?.items.find(item => item.sourceLine === this.selected);
  }

  /**
   * その行に置くならどの様式か。
   *
   * **先頭の様式に固定しない**——複数様式の DDS で、下の様式を狙って置いたのに
   * 先頭に足されると、画面上のどこにも現れない（利用者からは「消えた」ように見える）。
   * その行以下で最も近い項目の様式を採り、無ければ最後に現れた様式にする。
   */
  private recordAt(row: number): string | undefined {
    const items = this.model?.items ?? [];
    let best: RenderItem | undefined;
    for (const item of items) {
      if (item.recordName === undefined) continue;
      if (item.row > row) continue;
      if (!best || item.row > best.row || (item.row === best.row && item.sourceLine > best.sourceLine)) {
        best = item;
      }
    }
    return best?.recordName ?? this.model?.records[this.model.records.length - 1];
  }

  private dragTarget(gesture: Gesture, deltaX: number, deltaY: number): CellPoint {
    return movedTo(
      gesture.origin,
      deltaX,
      deltaY,
      gesture.widthCols,
      this.cellMetrics(),
      this.canvasSize()
    );
  }

  private resizeTarget(gesture: Gesture, deltaX: number): number {
    return resizedTo(
      gesture.widthCols,
      gesture.origin.column,
      deltaX,
      this.cellMetrics(),
      this.canvasSize()
    );
  }

  private cellAt(event: PointerEvent): CellPoint {
    const rect = this.canvas.getBoundingClientRect();
    const border = parseFloat(getComputedStyle(this.canvas).borderLeftWidth) || 0;
    return cellFromOffset(
      event.clientX - rect.left - border,
      event.clientY - rect.top - border,
      this.cellMetrics(),
      this.canvasSize()
    );
  }

  private cellMetrics(): CellMetrics {
    return { cellWidth: this.cellWidth, lineHeight: this.lineHeight };
  }

  private canvasSize(): CanvasSize {
    return this.model?.canvas ?? { rows: 24, columns: 80 };
  }

  private setStatus(message: string): void {
    this.status.textContent = message;
  }
}

/** 属性文字の占有を薄く示す（隣接違反が起きる前に見えるように）。 */
function attributeMarkers(item: RenderItem): HTMLElement[] {
  const markers: HTMLElement[] = [];
  for (const column of [item.occupancy.start, item.occupancy.end]) {
    if (column < 1) continue;
    const marker = document.createElement("div");
    marker.className = "dds-attr";
    marker.style.left = `calc(var(--cell-w) * ${column - 1})`;
    marker.style.top = `calc(var(--cell-h) * ${item.row - 1})`;
    markers.push(marker);
  }
  return markers;
}

function template(): string {
  return `
<div class="dds-app">
  <div class="dds-toolbar">
    <span class="record-name"></span>
    <button id="dds-add-field" type="button">フィールドを置く</button>
    <button id="dds-add-constant" type="button">定数を置く</button>
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

function text(tag: string, className: string, content: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}

function must<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`UI の要素が見つかりません: ${selector}`);
  return element;
}

function arrowStep(key: string): { row: number; column: number } | undefined {
  switch (key) {
    case "ArrowLeft": return { row: 0, column: -1 };
    case "ArrowRight": return { row: 0, column: 1 };
    case "ArrowUp": return { row: -1, column: 0 };
    case "ArrowDown": return { row: 1, column: 0 };
    default: return undefined;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
