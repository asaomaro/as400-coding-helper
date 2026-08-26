import type { DdsEdit } from "../../core/dds/ddsEdit";
import type { ItemAttributes, OutlineItem } from "../../core/dds/dspfOutline";
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
  /** 直近の拒否理由。プロパティ内に出す（フォーカスを奪わない場所）。 */
  private rejectMessage = "";
  /** 拒否されたときフォーカスを戻す欄。**入力し直せるようにする**（AC-I4）。 */
  private pendingFocus: string | undefined;
  private cellWidth = 8;
  private lineHeight = 18;

  private readonly frame: HTMLElement;
  private readonly ruler: HTMLElement;
  private readonly gutter: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly diagnostics: HTMLElement;
  private readonly outline: HTMLElement;
  private readonly properties: HTMLElement;
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
    this.outline = must(root, ".dds-outline");
    this.properties = must(root, ".dds-properties");
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
        this.rejectMessage = "";
        this.pendingFocus = undefined;
        this.setStatus("");
        this.render();
        break;
      case "rejected": {
        this.model = message.model as RenderModel;
        this.mode = "idle";
        this.gesture = undefined;
        this.pendingStructural = false;
        const rejections = (message.rejections ?? []) as ReadonlyArray<{ message: string }>;
        const reason = rejections.map(rejection => rejection.message).join(" / ");
        // 元の位置は UI が覚えず、ホストのモデルから描き直す（状態を 2 か所に置かない）。
        this.rejectMessage = reason;

        if (this.pendingFocus !== undefined) {
          // **再描画しない。** 文書は変わっていないので描き直す必要が無いうえ、
          // 描き直すと入力欄ごと作り替わり、フォーカスが飛ぶ。さらに消えた欄の `blur` が
          // もう一度 commit を呼び、拒否 → 再描画 → blur … と往復し続ける（実際に踏んだ）。
          const input = this.properties.querySelector<HTMLInputElement>(
            `input[data-key="${this.pendingFocus}"]`
          );
          input?.classList.add("rejected");
          input?.focus();
          input?.select();
          this.showReject(reason);
          this.pendingFocus = undefined;
          break;
        }

        // 元の位置は UI が覚えず、ホストのモデルから描き直す（状態を 2 か所に置かない）。
        this.setStatus(reason);
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

    // **編集中の欄を覚えておく。** 適用のたびにプロパティを作り直すので、
    // 覚えないと「名前を直して次に長さを直す」の途中でフォーカスが飛ぶ。
    const active = document.activeElement;
    const focusedKey =
      active instanceof HTMLElement && this.properties.contains(active)
        ? active.dataset.key
        : undefined;

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
    this.renderOutline(model);
    this.renderProperties(model);
    this.renderDiagnostics(model);

    const canAdd = model.records.length > 0 && this.options.askItem !== undefined;
    this.addField.disabled = !canAdd;
    this.addConstant.disabled = !canAdd;

    if (focusedKey !== undefined) {
      this.properties
        .querySelector<HTMLElement>(`[data-key="${focusedKey}"]`)
        ?.focus();
    }
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

  /**
   * 左ペイン。**描かれない項目も出す**——一覧が唯一の手がかりになる項目がある
   * （位置欄が空・画面に出ない用途は診断すら出ない）。
   */
  private renderOutline(model: RenderModel): void {
    if (model.outline.length === 0) {
      this.outline.replaceChildren(text("div", "dds-empty", "項目がありません"));
      return;
    }

    const list = document.createElement("ul");
    list.className = "dds-tree";

    for (const record of model.outline) {
      const heading = document.createElement("li");
      heading.className = "record";
      heading.textContent = record.name.length > 0 ? `R ${record.name}` : "（様式の外）";
      list.appendChild(heading);

      const children = document.createElement("ul");
      for (const item of record.items) {
        children.appendChild(this.buildOutlineItem(item));
      }
      heading.appendChild(children);
    }

    this.outline.replaceChildren(list);
  }

  private buildOutlineItem(item: OutlineItem): HTMLElement {
    const row = document.createElement("li");
    row.className = `item ${item.kind}`;
    if (item.hidden !== undefined) row.classList.add("hidden");
    if (item.sourceLine === this.selected) row.classList.add("selected");
    row.tabIndex = 0;
    row.dataset.sourceLine = String(item.sourceLine);

    const label = item.kind === "constant" ? `'${item.label}'` : item.label;
    row.append(
      text("span", "label", label.length > 0 ? label : "（名前なし）"),
      text("span", "at", describePlacement(item))
    );

    row.addEventListener("click", () => this.select(item.sourceLine));
    row.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.select(item.sourceLine);
      }
    });
    return row;
  }

  /** 右ペイン。選択中の項目の属性を出し、確定したら編集として送る。 */
  private renderProperties(model: RenderModel): void {
    const item = this.selectedOutlineItem(model);
    if (!item) {
      this.properties.replaceChildren(
        text("div", "dds-empty", "項目を選ぶと属性が出ます")
      );
      return;
    }

    const table = document.createElement("table");
    table.className = "dds-props";
    const fields: Array<[string, HTMLElement]> = [];

    if (item.kind === "constant") {
      fields.push(["文字列", this.attributeInput(item, "text", item.attributes.text ?? "")]);
    } else {
      fields.push(["名前", this.attributeInput(item, "name", item.attributes.name ?? "")]);
      fields.push([
        "長さ",
        this.attributeInput(item, "length", String(item.attributes.length ?? ""))
      ]);
      fields.push([
        "型",
        this.attributeInput(item, "dataType", item.attributes.dataType ?? "")
      ]);
      fields.push([
        "小数",
        this.attributeInput(item, "decimals", String(item.attributes.decimals ?? ""))
      ]);
      fields.push(["使用", this.usageSelect(item)]);
    }

    for (const [label, control] of fields) {
      const row = document.createElement("tr");
      const head = document.createElement("td");
      head.textContent = label;
      const cell = document.createElement("td");
      cell.appendChild(control);
      row.append(head, cell);
      table.appendChild(row);
    }

    const keywords = document.createElement("input");
    keywords.value = item.attributes.keywords;
    keywords.readOnly = true;
    keywords.title = "キーワード欄（45 桁〜）。ここでは編集しません";
    const keywordRow = document.createElement("tr");
    const keywordHead = document.createElement("td");
    keywordHead.textContent = "キーワード";
    const keywordCell = document.createElement("td");
    keywordCell.appendChild(keywords);
    keywordRow.append(keywordHead, keywordCell);
    table.appendChild(keywordRow);

    const nodes: HTMLElement[] = [table, this.measures(item, model)];
    if (item.kind === "field") {
      // 黙って壊さない。参照の追随は未実装なので、その旨を出す。
      nodes.push(
        text(
          "div",
          "dds-note",
          "名前を変えても、参照しているキーワード（SFLCTL 等）は追随しません"
        )
      );
    }
    const reject = text("div", "dds-reject", this.rejectMessage);
    nodes.push(reject);
    this.properties.replaceChildren(...nodes);
  }

  /** 占有と右端の余裕。**引き算だけ**（幅は core が決めたものを使う）。 */
  private measures(item: OutlineItem, model: RenderModel): HTMLElement {
    const placed = model.items.find(
      candidate => candidate.sourceLine === item.sourceLine
    );
    const box = document.createElement("div");
    box.className = "dds-measures";

    const put = (label: string, value: string): void => {
      const row = document.createElement("div");
      row.textContent = `${label}: ${value}`;
      box.appendChild(row);
    };

    if (!placed) {
      put("位置", describeHidden(item.hidden));
      put("占有", "—");
      put("右端の余裕", "—");
      return box;
    }

    put("位置", `${placed.row} 行 ${placed.column} 桁`);
    put(
      "占有",
      `${placed.occupancy.start} 〜 ${placed.occupancy.end} 桁（属性文字を含む）`
    );
    put("右端の余裕", `${model.canvas.columns - placed.occupancy.end} 桁`);
    return box;
  }

  private attributeInput(
    item: OutlineItem,
    key: keyof ItemAttributes,
    value: string
  ): HTMLInputElement {
    const input = document.createElement("input");
    input.value = value;
    input.dataset.key = String(key);
    if (key === "name") input.maxLength = 10;
    if (key === "dataType") input.maxLength = 1;

    // **確定した値を覚える。** `Enter` と `blur` の両方から commit が来るので、
    // 覚えないと同じ編集を 2 回送る（拒否されたときは往復が止まらなくなる）。
    let committed = value;
    const commit = (): void => {
      if (input.value === committed) return;
      committed = input.value;
      this.sendAttribute(item, key, input.value);
    };

    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // 編集前に戻す。**何も送らない。**
        input.value = value;
        input.blur();
      }
    });
    input.addEventListener("blur", commit);
    return input;
  }

  private usageSelect(item: OutlineItem): HTMLSelectElement {
    const select = document.createElement("select");
    select.dataset.key = "usage";
    for (const [value, label] of [
      ["", "（指定なし）"],
      ["I", "I 入力"],
      ["O", "O 出力"],
      ["B", "B 両用"],
      ["H", "H 潜在"]
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      if ((item.attributes.usage ?? "") === value) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      this.sendAttribute(item, "usage", select.value);
    });
    return select;
  }

  /** 属性 1 つを送る。**確定したときだけ**呼ばれる。 */
  private sendAttribute(item: OutlineItem, key: keyof ItemAttributes, raw: string): void {
    const value = raw.trim();
    const attributes: Record<string, unknown> = {};

    if (key === "length" || key === "decimals") {
      if (value.length === 0) return; // 空にはできない欄。何もしない。
      const parsed = Number(value);
      if (!Number.isInteger(parsed)) {
        this.showReject(`${key === "length" ? "長さ" : "小数"}は数値です`);
        return;
      }
      attributes[key] = parsed;
    } else {
      attributes[key] = key === "text" ? raw : value;
    }

    this.pendingFocus = String(key);
    this.send({
      kind: "setAttributes",
      sourceLine: item.sourceLine,
      attributes
    } as DdsEdit);
  }

  private selectedOutlineItem(model: RenderModel): OutlineItem | undefined {
    return model.outline
      .flatMap(record => record.items)
      .find(item => item.sourceLine === this.selected);
  }

  private showReject(message: string): void {
    this.rejectMessage = message;
    const box = this.properties.querySelector(".dds-reject");
    if (box) box.textContent = message;
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
    // **入力中はキャンバスへ漏らさない。** 入口で弾かないと、プロパティで矢印を押した瞬間に
    // 項目が動き、`Delete` で項目が消える。`Esc` だけは入力欄の取り消しとして通す
    // （入力欄側が値を戻してから blur するので、ここへは来ない）。
    if (isTypingTarget(event.target)) return;

    if (event.key === "Escape") {
      this.placing = null;
      this.updateArmed();
      this.select(undefined);
      this.setStatus("");
      return;
    }
    if (this.mode !== "idle" || this.selected === undefined) return;

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
  <div class="dds-panes">
    <div class="dds-side left">
      <div class="pane-title">レコード様式</div>
      <div class="dds-outline"></div>
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
    <div class="dds-side right">
      <div class="pane-title">プロパティ</div>
      <div class="dds-properties"></div>
    </div>
  </div>
  <div class="dds-diagnostics"></div>
</div>`;
}

/** 一覧に出す位置の表示。**描かれない項目は理由を出す**（一覧が唯一の手がかりなので）。 */
function describePlacement(item: OutlineItem): string {
  if (item.hidden !== undefined) return describeHidden(item.hidden);
  return `${item.row},${item.column}`;
}

function describeHidden(hidden: OutlineItem["hidden"]): string {
  switch (hidden) {
    case "no-position": return "位置なし";
    case "invalid-position": return "位置が不正";
    case "not-displayed": return "画面に出ない用途";
    default: return "—";
  }
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

/** 入力中か。プロパティの入力欄・選択欄にフォーカスがあるとき。 */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
