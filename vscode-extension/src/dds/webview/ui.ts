import type { DdsEdit } from "../../core/dds/ddsEdit";
import {
  conditionGroups,
  describeConditioning,
  evaluateConditioning,
  type IndicatorStates
} from "../../core/dds/ddsConditioning";
import {
  conditionLineCount,
  formatConditionText,
  parseConditionText
} from "../../core/dds/ddsConditionWriteBack";
import {
  findKeywordHelp,
  keywordsForLevel,
  parseKeywordEntries,
  type DdsKeywordHelp,
  type KeywordEntry,
  type KeywordLevel
} from "../../core/dds/ddsKeywords";
import type { ItemAttributes, OutlineItem } from "../../core/dds/dspfOutline";
import {
  CPI_VALUES,
  DEFAULT_DENSITY,
  LPI_VALUES,
  paperInches
} from "../../core/dds/prtfDensity";
import {
  applyIndicators,
  type RenderItem,
  type RenderModel
} from "../../core/dds/dspfRenderModel";
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
  /**
   * 行が**行送り**（`SPACE` / `SKIP`）で決まる（帳票）。
   *
   * true のとき**縦には動かさない**——位置欄に行番号を書き込むと行送りが無効になり、
   * 別のものになるため。桁だけを動かす（`moveColumn`）。
   */
  readonly rowFromSpacing: boolean;
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
  /**
   * 編集で項目の行がずれるとき、**次に選び直す行**。
   *
   * 条件の編集は行数を変えうる（OR や 4 つ以上の AND では条件だけの行が増える）。
   * 選択は行番号で持っているので、放っておくと**編集した直後に選択が迷子になる**
   * （プロパティごと消える。e2e で踏んだ）。
   */
  private pendingSelection: number | undefined;
  /** 実測値（フォントの実寸）。**倍率を掛けない**——掛けると次の測定で二重になる。 */
  private measuredWidth = 8;
  private measuredHeight = 18;
  /**
   * 表示の状態。**`render()` の外に持つ**——中に持つと再描画のたびに戻り、
   * 1 回編集するたびに切替が解除される。ホストへは送らない（表示は文書の内容ではない）。
   */
  private display = {
    showShifts: false,
    showAttributes: true,
    showGrid: true,
    dimOthers: true,
    /**
     * 5250 の配色で描く。**既定は入**——実機の見え方を出すのがこの画面の目的で、
     * 桁だけを見たい人が切る。
     */
    showColors: true,
    /**
     * 紙の比率で描く（帳票）。**既定は切**——等幅の升目は桁を数えるのに要る。
     */
    preview: false,
    /**
     * **2 次画面サイズの絵**。`DSPSIZ` が 2 つのサイズを宣言しているときだけ切り替えられる。
     * 位置は「位置の上書き行」（条件名 ＋ 位置）が決める。
     */
    secondaryScreen: false,
    zoom: 1
  };
  /**
   * 条件標識の状態。**未設定の標識は鍵ごと持たない**（`display` とは別に持つ——
   * `display` は真偽値と倍率だけの平坦な形で、鍵が増減する状態を混ぜると空判定が壊れる）。
   *
   * これも表示の状態なので**ホストへ送らない**。ソースは 1 文字も変わらない。
   */
  private indicators: IndicatorStates = {};
  /**
   * 標識の状態を反映したモデル。`render()` で作る。
   *
   * **`model` は生のまま残す**——状態を変えるたびにホストへ作り直しを頼まずに済むうえ、
   * 「ソースが言っていること」と「いま指定している標識で見えること」を取り違えない。
   */
  private view: RenderModel | undefined;
  /** 切替の直後にフォーカスを戻す標識。**戻さないと連続して切り替えられない。** */
  private pendingIndicatorFocus: string | undefined;
  /**
   * 原典から生成したキーワードの解説。**`load` で 1 回だけ受け取る**。
   *
   * 文書ごとに変わらない静的なデータ（日本語版は 140KB）なので、
   * 編集のたびに送り直させない。渡されなければ空のまま——
   * そのときは**「原典に無い」の印も出さない**（表が無いのだから当然で、誤解を招く）。
   */
  private keywordHelp: readonly DdsKeywordHelp[] = [];
  /** 解説を開いているキーワード（`<行>:<何番目>`）。選択が変われば当たらなくなる＝閉じる。 */
  private openKeyword: string | undefined;
  /**
   * プレビューで使う印刷密度。**利用者が選べる**（ソースの値を既定にする）。
   *
   * `undefined` のうちはモデルの値（＝ソース、無ければ `CRTPRTF` の既定）に従う。
   */
  private density: { cpi: number; lpi: number } | undefined;

  private readonly frame: HTMLElement;
  private readonly ruler: HTMLElement;
  private readonly gutter: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly densityBox: HTMLElement;
  private readonly diagnostics: HTMLElement;
  private readonly outline: HTMLElement;
  private readonly indicatorPanel: HTMLElement;
  private readonly properties: HTMLElement;
  private readonly status: HTMLElement;
  private readonly metrics: HTMLElement;
  private readonly title: HTMLElement;
  private readonly addField: HTMLButtonElement;
  private readonly addConstant: HTMLButtonElement;
  private readonly toggles: ReadonlyArray<{
    readonly button: HTMLButtonElement;
    readonly key:
      | "showShifts"
      | "showAttributes"
      | "showGrid"
      | "dimOthers"
      | "showColors"
      | "preview"
      | "secondaryScreen";
  }>;
  private readonly zoomButtons: HTMLButtonElement[] = [];

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
    this.densityBox = must(root, ".density");
    this.diagnostics = must(root, ".dds-diagnostics");
    this.outline = must(root, ".dds-outline");
    this.indicatorPanel = must(root, ".dds-indicators");
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

    this.toggles = [
      { button: must<HTMLButtonElement>(root, "#dds-toggle-shifts"), key: "showShifts" },
      { button: must<HTMLButtonElement>(root, "#dds-toggle-attributes"), key: "showAttributes" },
      { button: must<HTMLButtonElement>(root, "#dds-toggle-grid"), key: "showGrid" },
      { button: must<HTMLButtonElement>(root, "#dds-toggle-dim"), key: "dimOthers" },
      { button: must<HTMLButtonElement>(root, "#dds-toggle-colors"), key: "showColors" },
      { button: must<HTMLButtonElement>(root, "#dds-toggle-preview"), key: "preview" },
      { button: must<HTMLButtonElement>(root, "#dds-toggle-secondary"), key: "secondaryScreen" }
    ];
    for (const toggle of this.toggles) {
      toggle.button.addEventListener("click", () => {
        this.display = { ...this.display, [toggle.key]: !this.display[toggle.key] };
        this.render(); // 切替は選択に触らない（AC-I4）
      });
    }

    // ズームは**ボタンだけ**。キーを張るとホストのズームと取り合い、
    // 桁ルーラーが二重に拡大する（確定デザインの未解決 5）。
    const zoom = must<HTMLElement>(root, ".zoom");
    zoom.appendChild(text("span", "label", "ズーム"));
    for (const step of [0.9, 1, 1.25, 1.5]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${Math.round(step * 100)}%`;
      button.dataset.zoom = String(step);
      button.addEventListener("click", () => {
        this.display = { ...this.display, zoom: step };
        this.render();
      });
      this.zoomButtons.push(button);
      zoom.appendChild(button);
    }
  }

  handle(message: { type: string; [key: string]: unknown }): void {
    switch (message.type) {
      case "load":
        this.host = message.host as EditorHost;
        this.model = message.model as RenderModel;
        this.keywordHelp = (message.keywords ?? []) as readonly DdsKeywordHelp[];
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
        if (this.pendingSelection !== undefined) {
          this.selected = this.pendingSelection;
          this.pendingSelection = undefined;
        }
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
        this.pendingSelection = undefined;
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

    this.measuredWidth = rect.width / MEASURE_SAMPLE;
    this.measuredHeight = rect.height;
    this.applyCellSize();
    this.render();
  }

  /** 表示に使うセル寸法＝**実測値 × 倍率**。ルーラー・項目・座標変換がすべてこれを見る。 */
  /**
   * 1 インチのピクセル数。CSS の絶対単位の定義（`1in = 96px`）に合わせる。
   *
   * 倍率 100% のとき、画面上でおおよそ実寸になる。
   */
  private static readonly PX_PER_INCH = 96;

  private get cellWidth(): number {
    const density = this.previewDensity();
    // **プレビューでは実測を使わない。** 混ぜると倍率が二重に掛かる。
    return density
      ? (EditorView.PX_PER_INCH / density.cpi) * this.display.zoom
      : this.measuredWidth * this.display.zoom;
  }

  private get lineHeight(): number {
    const density = this.previewDensity();
    return density
      ? (EditorView.PX_PER_INCH / density.lpi) * this.display.zoom
      : this.measuredHeight * this.display.zoom;
  }

  /** プレビュー中なら使う印刷密度。それ以外は undefined（升目で描く）。 */
  private previewDensity(): { cpi: number; lpi: number } | undefined {
    if (!this.display.preview) return undefined;
    const model = this.view ?? this.model;
    if (model?.kind !== "prtf") return undefined;
    return this.density ?? model.density ?? DEFAULT_DENSITY;
  }

  private applyCellSize(): void {
    this.frame.style.setProperty("--cell-w", `${this.cellWidth}px`);
    this.frame.style.setProperty("--cell-h", `${this.lineHeight}px`);
    // **フォントは幅で合わせる。** 等幅なので幅が合えば桁が合う（高さは溢れてよい）。
    const scale = this.previewDensity() ? this.cellWidth / this.measuredWidth : 1;
    this.frame.style.setProperty("--font-scale", String(scale));
  }

  // ---- 描画 --------------------------------------------------------

  /**
   * 描く対象のモデル。**2 次画面サイズの切替が入っていればそちらへ差し替える。**
   *
   * 項目は同じ `sourceLine` を持つ（別の項目ではなく、同じ項目の別の位置）ので、
   * 一覧・プロパティ・標識はそのまま使える。
   */
  private screenModel(model: RenderModel): RenderModel {
    const secondary = model.secondaryScreen;
    if (!this.display.secondaryScreen || secondary === undefined) return model;
    return {
      ...model,
      canvas: secondary.canvas,
      items: secondary.items,
      diagnostics: secondary.diagnostics
    };
  }

  /**
   * 編集の宛先になる画面サイズ。**1 次なら undefined**（編集に載せない）。
   *
   * 2 次では位置を決めているのが**位置の上書き行**なので、`move` にこれを載せないと
   * 項目自身の行（＝1 次の位置）が黙って書き換わる。判定を 1 か所に閉じておく。
   */
  private get editingScreenSize(): "secondary" | undefined {
    return this.display.secondaryScreen && this.model?.secondaryScreen !== undefined
      ? "secondary"
      : undefined;
  }

  private render(): void {
    const model = this.model;
    if (!model) return;

    // **描くのは「その標識の状態で見えるもの」。** 生のモデルは `this.model` に残す。
    const view = applyIndicators(this.screenModel(model), this.indicators);
    this.view = view;

    this.applyCellSize();

    // **編集中の欄を覚えておく。** 適用のたびにプロパティを作り直すので、
    // 覚えないと「名前を直して次に長さを直す」の途中でフォーカスが飛ぶ。
    const active = document.activeElement;
    const focusedKey =
      active instanceof HTMLElement && this.properties.contains(active)
        ? active.dataset.key
        : undefined;

    this.frame.style.setProperty("--cols", String(view.canvas.columns));
    this.frame.style.setProperty("--rows", String(view.canvas.rows));
    // 画面の大きさを DOM にも出す（e2e が桁数を数えずに確かめられるように）。
    this.canvas.dataset.rows = String(view.canvas.rows);
    this.canvas.dataset.columns = String(view.canvas.columns);
    this.metrics.textContent =
      `セル ${this.cellWidth.toFixed(2)}×${this.lineHeight.toFixed(2)}px` +
      `${this.display.zoom === 1 ? "" : `（実測 ${this.measuredWidth.toFixed(2)}px × ${Math.round(this.display.zoom * 100)}%）`}` +
      ` / ${view.canvas.rows}×${view.canvas.columns}`;
    const kindLabel = view.kind === "prtf" ? "帳票" : "画面";
    this.title.textContent =
      `${kindLabel}｜` +
      (view.records.length > 0 ? `様式 ${view.records.join(" / ")}` : "（様式なし）");

    this.renderRuler(view.canvas.columns);
    this.renderGutter(view.canvas.rows);
    this.renderItems(view);
    this.renderOutline(view);
    this.renderIndicators(view);
    this.renderProperties(view);
    this.renderDiagnostics(view);

    for (const toggle of this.toggles) {
      toggle.button.classList.toggle("armed", this.display[toggle.key]);
      toggle.button.setAttribute("aria-pressed", String(this.display[toggle.key]));
      // 表示装置だけのものは帳票で**出さない**（押しても何も起きないボタンを置かない）。
      const displayOnly = toggle.key === "showAttributes" || toggle.key === "showColors";
      // プレビュー（紙の比率）は帳票だけ。画面に CPI / LPI は無い。
      const printOnly = toggle.key === "preview";
      // 2 次画面サイズは **`DSPSIZ` が 2 つ宣言しているときだけ**。
      const noSecondary =
        toggle.key === "secondaryScreen" && this.model?.secondaryScreen === undefined;
      toggle.button.hidden =
        (displayOnly && !this.isDisplayFile()) ||
        (printOnly && this.isDisplayFile()) ||
        noSecondary;
    }
    for (const button of this.zoomButtons) {
      button.classList.toggle("armed", Number(button.dataset.zoom) === this.display.zoom);
    }
    this.renderDensity(view);

    const canAdd = view.records.length > 0 && this.options.askItem !== undefined;
    this.addField.disabled = !canAdd;
    this.addConstant.disabled = !canAdd;

    if (focusedKey !== undefined) {
      this.properties
        .querySelector<HTMLElement>(`[data-key="${focusedKey}"]`)
        ?.focus();
    }

    if (this.pendingIndicatorFocus !== undefined) {
      // 選んだ値のボタンへ戻す（作り替えたので元の要素はもう無い）。
      this.indicatorPanel
        .querySelector<HTMLElement>(
          `[data-indicator="${this.pendingIndicatorFocus}"][aria-checked="true"]`
        )
        ?.focus();
      this.pendingIndicatorFocus = undefined;
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

  private renderItems(model: RenderModel): void {
    const items = model.items;
    this.canvas.classList.toggle("no-grid", !this.display.showGrid);

    // 淡くする基準は**選択中の項目が属する様式**。選択が無ければ基準が無いので淡くしない。
    const activeRecord = this.display.dimOthers
      ? items.find(item => item.sourceLine === this.selected)?.recordName
      : undefined;

    const nodes: HTMLElement[] = [];
    for (const item of items) {
      // **属性文字は表示装置のもの。** 印刷には出ないので帳票では描かない。
      if (this.display.showAttributes && this.isDisplayFile()) {
        nodes.push(...attributeMarkers(item, this.dimmed(item, activeRecord)));
      }
      const element = this.buildItem(item);
      if (this.dimmed(item, activeRecord)) element.classList.add("dimmed");
      nodes.push(element);
    }
    // **キャンバスは毎回作り替える**ので、線もここで一緒に入れる
    // （外に置くと `replaceChildren` で消える。実際に踏んだ）。
    const overflow = overflowLine(model);
    if (overflow) nodes.push(overflow);

    this.canvas.replaceChildren(...nodes);
  }


  /**
   * 印刷密度の選択（帳票のプレビュー中だけ出す）と、用紙の大きさ。
   *
   * 値は**原典から生成した集合**（`CPI(10|15)` / `LPI(4|6|8|9|12)`）。
   * 用紙の大きさは原典の式——高さ ＝ 行数 ÷ LPI、幅 ＝ 桁数 ÷ CPI
   * （原典の例「66 行 / 6 LPI ＝ 11.0 インチ」と一致する）。
   */
  private renderDensity(model: RenderModel): void {
    const density = this.previewDensity();
    if (!density) {
      this.densityBox.replaceChildren();
      this.densityBox.hidden = true;
      return;
    }
    this.densityBox.hidden = false;

    const nodes: HTMLElement[] = [];
    for (const [label, values, key] of [
      ["CPI", CPI_VALUES, "cpi"],
      ["LPI", LPI_VALUES, "lpi"]
    ] as const) {
      nodes.push(text("span", "label", label));
      const select = document.createElement("select");
      select.className = "density-select";
      select.dataset.key = `density:${key}`;
      select.setAttribute("aria-label", `${label}（1 インチ当たりの${key === "cpi" ? "文字数" : "行数"}）`);
      for (const value of values) {
        const option = document.createElement("option");
        option.value = String(value);
        option.textContent = String(value);
        option.selected = value === density[key];
        select.appendChild(option);
      }
      select.addEventListener("change", () => {
        this.density = { ...density, [key]: Number(select.value) };
        this.render();
      });
      nodes.push(select);
    }

    const paper = paperInches(model.canvas, density);
    nodes.push(
      text(
        "span",
        "paper",
        `用紙 ${paper.width.toFixed(1)} × ${paper.height.toFixed(1)} インチ`
      )
    );

    // ソースに複数書かれているなら**黙って 1 つで描かない**。
    const written = model.density?.written;
    if (model.density?.mixed && written) {
      const parts = [
        written.cpi.length > 1 ? `CPI ${written.cpi.join(" / ")}` : "",
        written.lpi.length > 1 ? `LPI ${written.lpi.join(" / ")}` : ""
      ].filter(Boolean);
      nodes.push(
        text("span", "mixed", `※ ソースに複数（${parts.join("・")}）。1 つで描いています`)
      );
    }

    this.densityBox.replaceChildren(...nodes);
  }

  /** 表示装置ファイルか。帳票には属性文字も 5250 の配色も無い。 */
  private isDisplayFile(): boolean {
    return (this.view ?? this.model)?.kind !== "prtf";
  }

  /** アクティブ様式の外か。基準が無ければ淡くしない。 */
  private dimmed(item: RenderItem, activeRecord: string | undefined): boolean {
    return activeRecord !== undefined && item.recordName !== activeRecord;
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
    element.dataset.rowFromSpacing = String(item.rowFromSpacing === true);
    if (item.rowFromSpacing) element.classList.add("row-from-spacing");
    element.style.left = `calc(var(--cell-w) * ${item.column - 1})`;
    element.style.top = `calc(var(--cell-h) * ${item.row - 1})`;
    element.style.width = `calc(var(--cell-w) * ${item.widthCols ?? 1})`;
    element.title =
      `${item.label}（${item.row} 行 ${item.column} 桁` +
      `${item.widthCols === undefined ? " / 幅不明" : ` / ${item.widthCols} 桁`}` +
      ` / ソース ${item.sourceLine} 行目${describeAppearance(item.appearance)}）`;

    // **配色は色だけ。桁と位置は変えない。**
    // 5250 の配色は表示装置ファイルのもの（PRTF に `DSPATR` は無い）。
    if (this.display.showColors && this.isDisplayFile()) {
      element.classList.add("colored", `c-${item.appearance.color}`);
      if (item.appearance.reverse) element.classList.add("reverse");
      if (item.appearance.underline) element.classList.add("underline");
      if (item.appearance.blink) element.classList.add("blink");
      if (item.appearance.nonDisplay) element.classList.add("non-display");
    }

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
      if (segment.shift !== undefined) {
        span.classList.add("shift");
        // **既に空けてある桁に描く。** 項目の前後に足すと幅が変わり、全部の桁がずれる。
        // 記号はテキストエディタ側の SOSI 表示と同じ `{` `}`（同じソースが別物に見えないように）。
        span.textContent = this.display.showShifts
          ? segment.shift === "so"
            ? "{"
            : "}"
          : "";
      } else {
        span.textContent = segment.text;
      }
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
    if (model.outline.length === 0 && model.fileKeywords.length === 0) {
      this.outline.replaceChildren(text("div", "dds-empty", "項目がありません"));
      return;
    }

    const list = document.createElement("ul");
    list.className = "dds-tree";

    // **ファイル・レベルのキーワードを先頭に置く。** 最初の様式より前にあるので、
    // ソースの並びと同じ順になる。ここに出さないとデザイナから一切読めない。
    if (model.fileKeywords.length > 0) {
      // **`record` を付けない。** 様式を選ぶ側が拾ってしまう（様式ではない）。
      const heading = text("li", "file-level", "");
      heading.append(text("span", "label", "ファイル"));
      list.appendChild(heading);

      const children = document.createElement("ul");
      for (const entry of model.fileKeywords) {
        const row = document.createElement("li");
        // **`item` にしない。** 項目を選ぶ側（一覧の走査・キー移動）が
        // ファイル・レベルの行まで拾ってしまう。これらは項目ではない。
        row.className = "file-keyword";
        row.tabIndex = 0;
        row.dataset.sourceLine = String(entry.sourceLine);
        if (entry.sourceLine === this.selected) row.classList.add("selected");
        row.append(text("span", "label", entry.keywords));
        row.title = `${entry.sourceLine} 行目`;
        row.addEventListener("click", event => {
          event.stopPropagation();
          this.select(entry.sourceLine);
        });
        row.addEventListener("keydown", event => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          this.select(entry.sourceLine);
        });
        children.appendChild(row);
      }
      heading.appendChild(children);
    }

    for (const record of model.outline) {
      const heading = document.createElement("li");
      heading.className = "record";
      // **様式そのものも選べるようにする。** `OVERLAY` / `CF03` のような
      // レコード・レベルのキーワードは様式宣言の行にしか無く、
      // 項目しか選べないとデザイナからは一切読めない。
      heading.tabIndex = 0;
      heading.dataset.sourceLine = String(record.sourceLine);
      if (record.sourceLine === this.selected) heading.classList.add("selected");
      heading.append(
        text("span", "label", record.name.length > 0 ? `R ${record.name}` : "（様式の外）")
      );
      // 項目は見出しの**中**（入れ子の ul）にあるので、クリックもキーも上がってくる。
      // **一番内側の li が自分かどうか**で見分ける（`.label` は項目側にもあるので使えない）。
      const isOwn = (target: EventTarget | null): boolean =>
        target instanceof HTMLElement && target.closest("li") === heading;

      heading.addEventListener("click", event => {
        if (!isOwn(event.target)) return;
        event.stopPropagation();
        this.select(record.sourceLine);
      });
      heading.addEventListener("keydown", event => {
        if (!isOwn(event.target)) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        this.select(record.sourceLine);
      });
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

  /**
   * 左ペイン下段。**このソースで使われている標識**を出し、3 値で倒せるようにする。
   *
   * ## なぜ 3 値か
   *
   * 「オン / オフ」の 2 値にすると、既定でどちらかに倒れる——`01` で条件付けた項目か、
   * `N01` で条件付けた項目のどちらかが**開いた瞬間から消えている**ことになる。
   * `未設定` があれば、**触っていない標識は今までどおり描かれる**（`unknown` は描く）。
   *
   * ## なぜラジオグループか
   *
   * 押すたびに巡回するボタンは、**現在値と次の値が読み取れない**（読み上げでは
   * 「01 ボタン」としか分からない）。APG のラジオグループなら `Tab` でグループに入り、
   * 矢印で値を選べて、選択中の値が読み上げられる。標識が並んでも `Tab` の回数が増えない。
   */
  private renderIndicators(model: RenderModel): void {
    if (model.indicators.length === 0) {
      this.indicatorPanel.replaceChildren(
        text("div", "dds-empty", "このソースでは使われていません")
      );
      return;
    }

    const nodes: HTMLElement[] = [];
    for (const usage of model.indicators) {
      const row = document.createElement("div");
      row.className = "ind-row";

      const head = document.createElement("div");
      head.className = "ind-head";
      head.append(
        text("span", "no", usage.indicator),
        text("span", "uses", `${usage.uses} か所`)
      );

      row.append(head, this.indicatorChoice(usage.indicator));
      nodes.push(row);
    }

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "ind-reset";
    reset.textContent = "すべて未設定";
    // **一覧に出ている標識だけで押せるかを決める。** 別のファイルを開いたときに残る
    // 状態（そのファイルに無い標識）は描画に効かない——項目の条件に現れる標識は
    // 必ず一覧にも出るため。効かない状態のために押せるボタンを出すと、
    // 「何かが設定されている」と読めてしまう。
    reset.disabled = !model.indicators.some(
      usage => this.indicators[usage.indicator] !== undefined
    );
    reset.addEventListener("click", () => {
      this.indicators = {};
      this.render();
    });
    nodes.push(reset);

    this.indicatorPanel.replaceChildren(...nodes);
  }

  /** 標識 1 つ分の 3 択（APG のラジオグループ：ローミング tabindex ＋ 矢印キー）。 */
  private indicatorChoice(indicator: string): HTMLElement {
    const group = document.createElement("div");
    group.className = "ind-choice";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", `標識 ${indicator}`);

    const values: ReadonlyArray<{ value: "unset" | "on" | "off"; label: string }> = [
      { value: "unset", label: "未設定" },
      { value: "on", label: "オン" },
      { value: "off", label: "オフ" }
    ];
    const current = this.indicators[indicator] ?? "unset";

    const buttons = values.map(({ value, label }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(value === current));
      button.textContent = label;
      button.dataset.indicator = indicator;
      button.dataset.value = value;
      // ローミング tabindex。Tab はグループに 1 回だけ入る。
      button.tabIndex = value === current ? 0 : -1;
      button.classList.toggle("armed", value === current);
      button.addEventListener("click", () => this.setIndicator(indicator, value));
      group.appendChild(button);
      return button;
    });

    group.addEventListener("keydown", event => {
      const step = radioStep(event.key);
      if (step === undefined) return;
      // **キャンバスへ漏らさない。** 漏らすと標識を選ぶたびに選択中の項目が動く。
      event.preventDefault();
      event.stopPropagation();
      const index = buttons.findIndex(button => button.tabIndex === 0);
      const next = step === "first" ? 0 : step === "last" ? values.length - 1
        : (index + step + values.length) % values.length;
      this.setIndicator(indicator, values[next].value);
    });

    return group;
  }

  private setIndicator(indicator: string, value: "unset" | "on" | "off"): void {
    const next: Record<string, "on" | "off"> = { ...this.indicators };
    if (value === "unset") {
      delete next[indicator];
    } else {
      next[indicator] = value;
    }
    this.indicators = next;
    this.pendingIndicatorFocus = indicator;
    this.render();
  }

  /** 右ペイン。選択中の項目の属性を出し、確定したら編集として送る。 */
  private renderProperties(model: RenderModel): void {
    const fileKeyword = model.fileKeywords.find(
      candidate => candidate.sourceLine === this.selected
    );
    if (fileKeyword !== undefined) {
      this.renderFileKeywordProperties(fileKeyword);
      return;
    }

    const record = model.outline.find(
      candidate => candidate.sourceLine === this.selected
    );
    if (record !== undefined) {
      this.renderRecordProperties(record);
      return;
    }

    const item = this.selectedOutlineItem(model);
    if (!item) {
      this.properties.replaceChildren(
        text("div", "dds-empty", "項目または様式を選ぶと属性が出ます")
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

    const condition = this.conditionInput(item);
    const conditionRow = document.createElement("tr");
    const conditionHead = document.createElement("td");
    conditionHead.textContent = "条件";
    const conditionCell = document.createElement("td");
    conditionCell.appendChild(condition);
    conditionRow.append(conditionHead, conditionCell);
    table.appendChild(conditionRow);

    const conditionalKeywords = this.describeConditionalKeywords(item);
    if (conditionalKeywords !== undefined) {
      const row = document.createElement("tr");
      const head = document.createElement("td");
      head.textContent = "キーワード行";
      const cell = document.createElement("td");
      cell.appendChild(conditionalKeywords);
      row.append(head, cell);
      table.appendChild(row);
    }

    const nodes: HTMLElement[] = [
      table,
      this.keywordSection(item.sourceLine, item.attributes.keywords, "field"),
      this.measures(item, model)
    ];
    const breakdown = this.columnBreakdown(item, model);
    if (breakdown !== undefined) nodes.push(breakdown);
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

  /**
   * 様式（`R XXXX`）のプロパティ。**キーワードだけ**を出す。
   *
   * 様式は画面上の位置も長さも持たないので、項目と同じ表は意味を持たない。
   * ここに出す価値があるのは `OVERLAY` / `CF03` のような
   * **レコード・レベルのキーワード**で、それは様式宣言の行にしか無い。
   */
  /**
   * ファイル・レベルのキーワードのプロパティ。
   *
   * **編集できる。** `setKeywords` の宛先はファイル・レベルの行も引けるようにしてある
   * （論理単位にならないので、`ddsEdit` が生の行から別に引く）。
   *
   * `＋`（候補から足す）も出す。候補はキーワードの**使用レベル**で絞っており、
   * ファイル・レベルの一覧は原典から生成済み（DSPF 47 件 / PRTF 9 件）。
   */
  private renderFileKeywordProperties(entry: RenderModel["fileKeywords"][number]): void {
    const nodes: HTMLElement[] = [
      text("div", "dds-record-title", "ファイル・レベルのキーワード"),
      this.keywordSection(entry.sourceLine, entry.keywords, "file")
    ];
    const condition = describeConditioning(entry.condition);
    if (condition.length > 0) {
      nodes.push(text("div", "dds-note", `条件: ${condition}`));
    }
    nodes.push(text("div", "dds-note", `${entry.sourceLine} 行目`));
    this.properties.replaceChildren(...nodes);
  }

  private renderRecordProperties(record: RenderModel["outline"][number]): void {
    const nodes: HTMLElement[] = [
      text(
        "div",
        "dds-record-title",
        record.name.length > 0 ? `様式 ${record.name}` : "（様式の外）"
      ),
      this.keywordSection(record.sourceLine, record.keywords, "record")
    ];
    if (record.keywords.trim().length === 0) {
      nodes.push(text("div", "dds-note", "この様式にはレコード・レベルのキーワードがありません"));
    }
    this.properties.replaceChildren(...nodes);
  }

  /**
   * キーワード欄を**チップの並び**にし、選ぶと原典の解説を出す。
   *
   * ## なぜ 1 本の文字列ではいけないか
   *
   * `toLogicalUnits` はキーワード継続行を空白 1 個で連結するので、
   * `DSPATR(RI) COLOR(RED) CHECK(RZ)` が 1 つの塊に見える。**どこで切れているか**が読めず、
   * ましてや `RZ` が何かは知っている人にしか分からない。
   * 原典の解説は**既にリポジトリにある**のに、テキストエディタの補完でしか出てこなかった。
   *
   * ## 消さない・並べ替えない
   *
   * 原典に無い綴りも**印を付けて出す**。消すと「書いたのに無い」が起き、原因が掴めなくなる。
   * 定数のリテラルは**キーワードではない**ので、そう分かる形にする
   * （キーワード扱いすると、定数を選ぶたびに誤った印が付く）。
   */
  private keywordSection(
    sourceLine: number,
    keywords: string,
    level: KeywordLevel,
    options: { readOnly?: boolean } = {}
  ): HTMLElement {
    const section = document.createElement("div");
    section.className = "kw-section";
    section.appendChild(text("div", "kw-label", "キーワード"));

    const entries = parseKeywordEntries(keywords);
    const chips = document.createElement("div");
    chips.className = "kw-chips";

    if (entries.length === 0) {
      chips.appendChild(text("span", "kw-chip none", "未設定"));
    }

    let help: HTMLElement | undefined;
    entries.forEach((entry, index) => {
      const key = `${sourceLine}:${index}`;
      const found =
        entry.kind === "keyword" && this.keywordHelp.length > 0
          ? findKeywordHelp(entry.name, this.keywordHelp)
          : undefined;
      // 表が無いときは「原典に無い」と言えない（言えば必ず全部に付く）。
      const unknown =
        entry.kind === "keyword" && this.keywordHelp.length > 0 && found === undefined;

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `kw-chip ${entry.kind}${unknown ? " unknown" : ""}`;
      chip.textContent = entry.raw;
      chip.dataset.key = `kw:${index}`;
      chip.dataset.keyword = entry.name;
      chip.title = describeChip(entry, found, unknown);
      chip.addEventListener("click", () => this.toggleKeyword(key));
      chips.appendChild(chip);

      // 定数のリテラルには `✕` を付けない——消すと項目でなくなり、キャンバスから消える
      // （core も `constant-needs-literal` で拒否する）。
      if (entry.kind === "keyword" && options.readOnly !== true) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "kw-x";
        remove.textContent = "✕";
        remove.title = `${entry.name} を外す`;
        remove.dataset.key = `kwx:${index}`;
        remove.addEventListener("click", () => this.removeKeyword(sourceLine, entries, index));
        chips.appendChild(remove);
      }

      if (this.openKeyword === key && found !== undefined) {
        chip.classList.add("open");
        help = keywordHelpBlock(found);
      }
    });

    if (options.readOnly !== true) {
      chips.appendChild(this.addKeywordButton(sourceLine, keywords, level));
    }
    chips.addEventListener("keydown", event => this.onKeywordKey(event, chips));
    section.appendChild(chips);
    if (help !== undefined) section.appendChild(help);

    // **生テキストは編集できる。** 引数を直に書き換える手段であり、
    // 桁を数えたい人・コピーしたい人の手段でもある。折り返しは core がやる。
    const raw = document.createElement("input");
    if (options.readOnly === true) raw.readOnly = true;
    raw.className = "kw-raw";
    raw.value = keywords;
    raw.dataset.key = "kw:raw";
    raw.title = "キーワード欄（45 桁〜）。Enter で確定、Esc で元に戻す。桁は自動で折ります";
    raw.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        raw.blur();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        raw.value = keywords;
        raw.blur();
      }
    });
    raw.addEventListener("blur", () => {
      if (raw.value === keywords) return;
      this.sendKeywords(sourceLine, raw.value);
    });
    section.appendChild(raw);

    return section;
  }

  /**
   * `＋` と、その場で開く候補つきの入力欄。
   *
   * 候補は**原典の表**（`load` で受け取ったもの）から、そのレベルのものを出す。
   * `<datalist>` を使うのは、**ホストに入力箱を頼まずに済む**ため——
   * プロトコルを増やさずに、両方のホストで同じ形が動く。
   *
   * **絞り込みは候補の並びにだけ効かせる。** 書けるかどうかの検証には使わない
   * （レベルの判定を誤ると、正しい記述を拒否することになる）。
   */
  private addKeywordButton(
    sourceLine: number,
    keywords: string,
    level: KeywordLevel
  ): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "kw-add";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "kw-chip add";
    button.textContent = "＋ 追加";
    button.dataset.key = "kw:add";
    wrap.appendChild(button);

    const input = document.createElement("input");
    input.className = "kw-add-input";
    input.placeholder = "キーワード名";
    input.dataset.key = "kw:add-input";
    input.hidden = true;

    const list = document.createElement("datalist");
    const listId = `dds-kw-${level}`;
    list.id = listId;
    // 絞り込みは core（`keywordsForLevel`）。ここに写すと、単体で確かめられる規則と
    // 画面に出る規則が別々に育つ。
    for (const help of keywordsForLevel(this.keywordHelp, level)) {
      const option = document.createElement("option");
      option.value = help.name;
      option.label = help.title;
      list.appendChild(option);
    }
    input.setAttribute("list", listId);
    wrap.append(input, list);

    button.addEventListener("click", () => {
      input.hidden = false;
      input.value = "";
      input.focus();
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        input.hidden = true;
        button.focus();
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      const name = input.value.trim().toUpperCase();
      if (name.length === 0) return;
      const help = findKeywordHelp(name, this.keywordHelp);
      // 引数を取るキーワードは括弧まで書いて、続きを入力できる形で渡す。
      const added = help?.hasParameters === false ? name : `${name}()`;
      this.sendKeywords(sourceLine, `${keywords} ${added}`.trim());
    });

    return wrap;
  }

  private removeKeyword(
    sourceLine: number,
    entries: readonly KeywordEntry[],
    index: number
  ): void {
    const next = entries
      .filter((_, position) => position !== index)
      .map(entry => entry.raw)
      .join(" ");
    this.sendKeywords(sourceLine, next);
  }

  /**
   * キーワード欄の置き換えを送る。
   *
   * 拒否されたときの戻り先は**生テキストの入力欄**にする——理由を読んで直せる唯一の場所で、
   * チップの `✕` は消えている可能性があるため。
   */
  private sendKeywords(sourceLine: number, keywords: string): void {
    this.pendingFocus = "kw:raw";
    this.send({ kind: "setKeywords", sourceLine, keywords });
  }

  private toggleKeyword(key: string): void {
    this.openKeyword = this.openKeyword === key ? undefined : key;
    this.render();
  }

  /**
   * チップ上のキー。**キャンバスへ漏らさない**——漏らすと `Delete` で項目が消え、
   * 矢印で項目が動く（プロパティの入力欄で一度踏んだのと同じ罠）。
   *
   * `F1` を解説に割り当てるのは、この PJ のプロンプターと同じ作法
   * （フォーカス中の項目のヘルプは `F1`）。
   */
  private onKeywordKey(event: KeyboardEvent, chips: HTMLElement): void {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !chips.contains(target)) return;

    if (event.key === "F1") {
      event.preventDefault();
      event.stopPropagation();
      target.click();
      return;
    }
    if (event.key === "Escape" && this.openKeyword !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      this.openKeyword = undefined;
      this.render();
      return;
    }
    if (/^(Delete|Backspace|Arrow(Up|Down|Left|Right))$/u.test(event.key)) {
      event.stopPropagation();
    }
  }

  /**
   * 条件標識の入力欄。**短い形**（`N50 01, 60` ＝ AND は空白 / OR はカンマ）で打つ。
   *
   * ソースの桁（7 桁目の `A`/`O`、3 桁ずつの枠）を打たせると必ずずれるので、
   * 1 行の形で受けて書き戻しは core（`writeBackCondition`）に任せる。
   * **OR や 4 つ以上の AND では行が増える**が、それも core が面倒を見る。
   *
   * 読み書きで**同じ形**を使う（`formatConditionText` / `parseConditionText`）
   * ——往復しない形にすると、開いて閉じただけで条件が変わる。
   */
  private conditionInput(item: OutlineItem): HTMLInputElement {
    const input = document.createElement("input");
    // 他の入力欄と同じく `data-key` で引けるようにする（e2e の宛先にもなる）。
    input.dataset.key = "condition";
    const placed = this.model?.items.find(
      candidate => candidate.sourceLine === item.sourceLine
    );
    const groups = placed ? conditionGroups(placed.condition) : [];
    // 画面サイズ条件名はそのまま出す（短い形の一部として打ち直せる）。
    const current =
      placed?.condition.kind === "screen-size"
        ? placed.condition.name
        : formatConditionText(groups);
    input.value = current;
    input.placeholder = "なし";
    input.title =
      "条件。標識は AND が空白・OR がカンマ（例: N50 01, 60）。" +
      "画面サイズ条件名（例: *DS4）も書けます。空にすると条件を外します" +
      `${this.describeConditionState(item)}`;

    // **画面サイズ条件名も同じ欄で編集する**（`*DS3` 等）。標識とは混ぜられないので、
    // どちらか一方だけを打つ形になる（混ぜたら core の検証が断る）。
    if (placed?.condition.kind === "screen-size") {
      input.value = placed.condition.name;
    }

    const commit = (): void => {
      if (input.value.trim() === current.trim()) return;
      const parsed = parseConditionText(input.value);
      if (!parsed.ok) {
        this.setStatus(parsed.message);
        input.value = current;
        return;
      }
      // **行がずれる分だけ選択を送る。** 数え方は core（`conditionLineCount`）に任せ、
      // ここには写さない。
      this.pendingSelection =
        item.sourceLine +
        (conditionLineCount(parsed.groups) - conditionLineCount(groups));
      this.send({
        kind: "setCondition",
        sourceLine: item.sourceLine,
        condition: parsed.groups,
        ...(parsed.screenSize !== undefined ? { screenSizeName: parsed.screenSize } : {})
      });
    };
    // 他の入力欄（`attributeInput`）と同じ約束にそろえる:
    // Enter で確定 / Escape で戻す / 抜けたら確定。
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // 編集前に戻す。**何も送らない。**
        input.value = current;
        input.blur();
      }
    });
    input.addEventListener("blur", commit);
    return input;
  }

  /** いまの標識でその項目が出るか。入力欄の説明に添える。 */
  private describeConditionState(item: OutlineItem): string {
    if (Object.keys(this.indicators).length === 0) return "";
    const placed = this.model?.items.find(
      candidate => candidate.sourceLine === item.sourceLine
    );
    if (!placed) return "";
    switch (evaluateConditioning(placed.condition, this.indicators)) {
      case "shown": return "（いまは 出る）";
      case "hidden": return "（いまは 出ない）";
      default: return "（いまは 決まらない）";
    }
  }

  /**
   * **条件つきのキーワード**を出す。無ければ行ごと出さない。
   *
   * 原典は条件が付く対象を「フィールド**または**キーワード」としており、
   * `30 DSPATR(RI)` のようにキーワードだけが条件つきの形がある。
   * 「常にこう見える」のか「ある標識のときだけ」かで読み方が変わるので、
   * チップ（全部のキーワード）とは**別の行**で示す。
   *
   * 標識を指定しているときは、いまその条件が効いているかも添える。
   */
  private describeConditionalKeywords(item: OutlineItem): HTMLElement | undefined {
    const placed = this.model?.items.find(
      candidate => candidate.sourceLine === item.sourceLine
    );
    // **先頭の群は代表行**（項目自身の条件で決まる。`条件` 欄がそれを編集する）。
    // ここに出すのは**別の行に書かれたキーワード**だけ。
    const groups = (placed?.keywordGroups ?? []).slice(1);
    if (groups.length === 0) return undefined;

    const list = document.createElement("div");
    list.className = "dds-conditional-keywords";
    const specified = Object.keys(this.indicators).length > 0;

    for (const group of groups) {
      const row = document.createElement("div");
      row.className = "dds-conditional-keyword";

      const label = document.createElement("span");
      label.className = "kw";
      label.textContent = group.keywords;
      label.title = `${group.sourceLine} 行目`;

      const input = document.createElement("input");
      input.dataset.key = "keywordCondition";
      input.dataset.sourceLine = String(group.sourceLine);
      const current = formatConditionText(conditionGroups(group.conditioning));
      input.value = current;
      input.placeholder = "条件なし";
      const state = specified
        ? evaluateConditioning(group.conditioning, this.indicators)
        : undefined;
      input.title =
        `${group.sourceLine} 行目のキーワードの条件。AND は空白、OR はカンマ（例: N50 01, 60）` +
        (state === "shown" ? "（いまは 効く）"
          : state === "hidden" ? "（いまは 効かない）"
          : state === "unknown" ? "（いまは 決まらない）" : "");
      if (state === "hidden") row.classList.add("is-off");

      const commit = (): void => {
        if (input.value.trim() === current.trim()) return;
        const parsed = parseConditionText(input.value);
        if (!parsed.ok) {
          this.setStatus(parsed.message);
          input.value = current;
          return;
        }
        this.send({
          kind: "setKeywordCondition",
          sourceLine: group.sourceLine,
          condition: parsed.groups,
          ...(parsed.screenSize !== undefined ? { screenSizeName: parsed.screenSize } : {})
        });
      };
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          input.value = current;
          input.blur();
        }
      });
      input.addEventListener("blur", commit);

      row.append(label, input);
      list.appendChild(row);
    }
    return list;
  }

  /**
   * 桁勘定。**定数だけ**に出す（フィールドはプレースホルダなので内訳に意味が無い）。
   *
   * 区切りを数えるだけで作る——**文字を数え直さない**。
   * 「なぜこの定数は 10 桁なのか」を画面で説明できるようにするのが目的。
   */
  private columnBreakdown(
    item: OutlineItem,
    model: RenderModel
  ): HTMLElement | undefined {
    const placed = model.items.find(
      candidate => candidate.sourceLine === item.sourceLine
    );
    if (!placed || placed.kind !== "constant" || placed.segments.length === 0) {
      return undefined;
    }

    const parts: string[] = [];
    let shifts = 0;
    let dbcs = 0;
    let sbcs = 0;
    for (const segment of placed.segments) {
      if (segment.shift !== undefined) {
        shifts += 1;
        continue;
      }
      // 全角は 1 文字が 2 桁。cols と文字数の差で見分けられる（文字を判定しない）。
      if (segment.cols === [...segment.text].length * 2) {
        dbcs += [...segment.text].length;
      } else {
        sbcs += segment.cols;
      }
    }

    if (shifts > 0) parts.push(`SO/SI ${shifts}`);
    if (dbcs > 0) parts.push(`全角 ${dbcs} × 2`);
    if (sbcs > 0) parts.push(`半角 ${sbcs}`);

    return text(
      "div",
      "dds-measures breakdown",
      `桁勘定: ${parts.join(" + ")} = ${placed.widthCols} 桁`
    );
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

    // **2 次では長さを変えられない。** 位置の上書き行は長さ欄を持てず
    // （実機で確認）、長さは画面サイズで変わらない。掴ませずに理由を出す。
    if (this.editingScreenSize !== undefined && target?.dataset.role === "resize") {
      const picked = target.closest<HTMLElement>(".dds-item");
      this.select(picked ? Number(picked.dataset.sourceLine) : undefined);
      this.setStatus("長さは画面サイズで変わりません（上書き行は位置だけを持ちます）");
      return;
    }

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
      element: current,
      rowFromSpacing: current.dataset.rowFromSpacing === "true"
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
      const screenSize = this.editingScreenSize;
      this.send(
        gesture.rowFromSpacing
          ? { kind: "moveColumn", sourceLine: gesture.sourceLine, column: target.column }
          : {
              kind: "move",
              sourceLine: gesture.sourceLine,
              row: target.row,
              column: target.column,
              ...(screenSize !== undefined ? { screenSize } : {})
            }
      );
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
      // **2 次では「項目を消す」ではなく「上書き行を消す」。** 2 次の絵で項目を
      // 選んで Delete を押した人が期待するのは、その画面での位置指定を取り消すこと
      // ——項目そのものが両方の画面から消えることではない。
      this.send(
        this.editingScreenSize === undefined
          ? { kind: "remove", sourceLine: item.sourceLine }
          : { kind: "clearAlternatePosition", sourceLine: item.sourceLine }
      );
      return;
    }

    const step = arrowStep(event.key);
    if (!step) return;
    event.preventDefault();
    const canvas = this.canvasSize();
    const column = clamp(item.column + step.column, 1, canvas.columns);

    // 行送りで決まる行は上下させない（帳票）。桁だけを動かす。
    if (item.rowFromSpacing) {
      if (step.column === 0) return;
      this.send({ kind: "moveColumn", sourceLine: item.sourceLine, column });
      return;
    }

    const screenSize = this.editingScreenSize;
    this.send({
      kind: "move",
      sourceLine: item.sourceLine,
      row: clamp(item.row + step.row, 1, canvas.rows),
      column,
      ...(screenSize !== undefined ? { screenSize } : {})
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

  /**
   * 選択中の項目。**描かれているものだけ**（`view`）から探す。
   *
   * 条件で消えている項目まで返すと、見えない項目が矢印キーで動き、
   * 「何も無いところで押したのにソースが変わった」が起きる。
   */
  private selectedItem(): RenderItem | undefined {
    return (this.view ?? this.model)?.items.find(item => item.sourceLine === this.selected);
  }

  /**
   * その行に置くならどの様式か。
   *
   * **先頭の様式に固定しない**——複数様式の DDS で、下の様式を狙って置いたのに
   * 先頭に足されると、画面上のどこにも現れない（利用者からは「消えた」ように見える）。
   * その行以下で最も近い項目の様式を採り、無ければ最後に現れた様式にする。
   */
  private recordAt(row: number): string | undefined {
    const items = (this.view ?? this.model)?.items ?? [];
    let best: RenderItem | undefined;
    for (const item of items) {
      if (item.recordName === undefined) continue;
      if (item.row > row) continue;
      if (!best || item.row > best.row || (item.row === best.row && item.sourceLine > best.sourceLine)) {
        best = item;
      }
    }
    const records = (this.view ?? this.model)?.records ?? [];
    return best?.recordName ?? records[records.length - 1];
  }

  private dragTarget(gesture: Gesture, deltaX: number, deltaY: number): CellPoint {
    const target = movedTo(
      gesture.origin,
      deltaX,
      // 行送りで決まる行は動かさない。**縦の移動そのものを起こさない**ので、
      // 拒否が出るのではなく「掴んでも上下しない」という手応えになる。
      gesture.rowFromSpacing ? 0 : deltaY,
      gesture.widthCols,
      this.cellMetrics(),
      this.canvasSize()
    );
    return gesture.rowFromSpacing ? { ...target, row: gesture.origin.row } : target;
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

/** チップの吹き出し。押す前に何なのかが分かるようにする。 */
function describeChip(
  entry: KeywordEntry,
  found: DdsKeywordHelp | undefined,
  unknown: boolean
): string {
  if (entry.kind === "literal") return "定数（固定情報）。キーワードではありません";
  if (unknown) return `${entry.name} は原典のキーワード一覧にありません`;
  if (found === undefined) return entry.name;
  return `${found.name} — ${found.title}（押すと解説）`;
}

/** 使用レベルの日本語。原典の言い回しに合わせる。 */
const LEVEL_LABELS: Readonly<Record<string, string>> = {
  file: "ファイル",
  record: "レコード",
  field: "フィールド",
  key: "キー",
  join: "結合",
  select: "選択",
  help: "ヘルプ"
};

/**
 * 原典の解説。**ここで文章を書き起こさない**——出所は
 * `docs/origin/generate-dds-keywords.mjs` が原典から生成したデータだけ。
 */
function keywordHelpBlock(help: DdsKeywordHelp): HTMLElement {
  const block = document.createElement("div");
  block.className = "kw-help";
  block.appendChild(text("div", "kw-help-title", `${help.name} — ${help.title}`));

  if (help.level && help.level.length > 0) {
    const labels = help.level.map(level => LEVEL_LABELS[level] ?? level).join(" / ");
    block.appendChild(text("div", "kw-help-level", `レベル: ${labels}`));
  }
  for (const syntax of help.syntax ?? []) {
    block.appendChild(text("div", "kw-help-syntax", syntax));
  }
  if (help.description) {
    block.appendChild(text("div", "kw-help-text", help.description));
  }
  return block;
}

/**
 * 見え方の説明（吹き出しに添える）。**「書いたのに出ない」を先に見せる**のが要点。
 */
function describeAppearance(appearance: RenderItem["appearance"]): string {
  // 吹き出しは素のテキスト。強調記号を書いても記号のまま出る。
  if (appearance.nonDisplay) return " / 非表示になります（UL＋HI＋RI は ND と同じ）";
  const marks = [
    ["reverse", "反転表示"],
    ["underline", "下線"],
    ["blink", "明滅"]
  ] as const;
  const extra = marks
    .filter(([key]) => appearance[key])
    .map(([, label]) => label)
    .join("・");
  const color = COLOR_LABELS[appearance.color] ?? appearance.color;
  return ` / ${color}${extra ? `・${extra}` : ""}`;
}

/** 原典の色名。**表示にだけ使う**（識別子は英語）。 */
const COLOR_LABELS: Readonly<Record<string, string>> = {
  green: "緑",
  white: "白",
  red: "赤",
  turquoise: "空",
  yellow: "黄",
  pink: "ピンク",
  blue: "青"
};

/**
 * オーバーフロー行（帳票）。ここを越えると次のページに送られる。
 *
 * 紙面の大きさと同じく **DDS には書かれていない**（`CRTPRTF` の `OVRFLW`）ので、
 * ホストが設定から渡した値をそのまま引く。画面ファイルには無い概念。
 */
function overflowLine(model: RenderModel): HTMLElement | undefined {
  const line = model.overflowLine;
  if (line === undefined || line < 1 || line > model.canvas.rows) return undefined;

  const element = document.createElement("div");
  element.className = "dds-overflow";
  element.style.top = `calc(var(--cell-h) * ${line})`;
  element.title = `オーバーフロー行 ${line}（CRTPRTF の OVRFLW）`;
  return element;
}

/** 属性文字の占有を薄く示す（隣接違反が起きる前に見えるように）。 */
function attributeMarkers(item: RenderItem, dimmed = false): HTMLElement[] {
  const markers: HTMLElement[] = [];
  for (const column of [item.occupancy.start, item.occupancy.end]) {
    if (column < 1) continue;
    const marker = document.createElement("div");
    marker.className = dimmed ? "dds-attr dimmed" : "dds-attr";
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
    <span class="sep"></span>
    <button id="dds-toggle-shifts" type="button" title="DBCS の前後にある SO / SI を { } で表示します（桁は元から空いています）">SO/SI</button>
    <button id="dds-toggle-attributes" type="button" title="項目の前後 1 桁を占める属性文字を示します">属性バイト</button>
    <button id="dds-toggle-grid" type="button" title="桁のグリッドを表示します">グリッド</button>
    <button id="dds-toggle-dim" type="button" title="選択中の項目が属する様式以外を淡く表示します">他様式を淡く</button>
    <button id="dds-toggle-colors" type="button" title="COLOR / DSPATR から実機の見え方（色・反転表示・下線・非表示）で描きます">5250 配色</button>
    <button id="dds-toggle-preview" type="button" title="CPI / LPI で決まる紙の比率で描きます（1 桁 = 1/CPI インチ、1 行 = 1/LPI インチ）">プレビュー</button>
    <button id="dds-toggle-secondary" type="button" title="2 次画面サイズでの見え方を描きます（動かすと位置の上書き行に書きます。長さは変えられません）">2 次画面</button>
    <span class="density" role="group" aria-label="印刷密度"></span>
    <span class="sep"></span>
    <span class="zoom" role="group" aria-label="ズーム"></span>
    <span class="spacer"></span>
    <span class="status"></span>
    <span class="dds-metrics"></span>
  </div>
  <div class="dds-panes">
    <div class="dds-side left">
      <div class="pane-title">レコード様式</div>
      <div class="dds-outline"></div>
      <div class="pane-title">条件標識</div>
      <div class="dds-indicators"></div>
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
    case "condition-off": return "条件で非表示";
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
/**
 * ラジオグループでの移動量。APG の Radio Group パターンに合わせる
 * （前後の巡回 ＋ Home / End で両端）。当たらないキーは `undefined`。
 */
function radioStep(key: string): number | "first" | "last" | undefined {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown": return 1;
    case "ArrowLeft":
    case "ArrowUp": return -1;
    case "Home": return "first";
    case "End": return "last";
    default: return undefined;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
