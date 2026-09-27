import type { DdsEdit } from "../../core/dds/ddsEdit";
import {
  conditionGroups,
  describeConditioning,
  evaluateConditioning,
  resolveKeywordGroups,
  type IndicatorStates,
  type KeywordGroup
} from "../../core/dds/ddsConditioning";
import { toLogicalUnits } from "../../core/dds/ddsLogicalUnits";
import {
  conditionLineCount,
  formatConditionText,
  parseConditionText
} from "../../core/dds/ddsConditionWriteBack";
import { findFieldReferences, findRecordReferences } from "../../core/dds/ddsReferences";
import { printColorLabel, type PrintAppearance } from "../../core/dds/prtfAppearance";
import { selectPrintPage } from "../../core/dds/prtfRenderModel";
import {
  findKeywordHelp,
  genericKeywordPrefix,
  requiresParameters,
  genericKeywordRange,
  keywordsForLevel,
  parseKeywordEntries,
  type DdsKeywordHelp,
  type KeywordEntry,
  type KeywordLevel
} from "../../core/dds/ddsKeywords";
import type { ItemAttributes, OutlineItem } from "../../core/dds/dspfOutline";
import { keywordsNotAllowedAt, levelLabel, levelsOf } from "../../core/dds/ddsKeywordLevels";
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
import { windowBounds, windowOrigin, type DspfWindow } from "../../core/dds/dspfWindow";
import {
  buildGridKeyword,
  geometryFromCells,
  rewriteGridKeyword,
  type GridColor,
  type GridGeometry,
  type GridLine,
  type GridLineType,
  type GridShape
} from "../../core/dds/dspfGrid";
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
 * 「ファイル」の節の、まだ行が無いときの仮の行。ソースの行番号は 1 始まりなので 0 は重ならない。
 * これを選ぶとファイル・レベルのキーワードを足す欄が出る（実操作調査の D1）。
 */
const NEW_FILE_KEYWORD_LINE = 0;

/** 一覧のドラッグで運ぶ項目の型（他のドラッグと混ざらないよう専用の型にする）。 */
const DRAG_ITEM_TYPE = "application/x-dds-item";

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
type Placing = "field" | "constant" | "grid" | null;

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
  /** ウィンドウの中の項目なら、描くときに足す量と動かせる範囲（位置はウィンドウの中の値のまま）。 */
  readonly window?: { readonly origin: CellPoint; readonly bounds: CanvasSize };
}

/** 追加の内容をホストに聞く（ホストが入力手段を持つ）。 */
export type AskItem = (
  kind: "field" | "constant" | "hidden",
  /** 潜在フィールド（`hidden`）は位置を持たないので無い。 */
  at?: CellPoint
) => Promise<Record<string, unknown> | undefined>;

/** 下部ドックと左右ペインの状態。**ホストに依らない**ので `localStorage` に置く。 */
interface PanelState {
  dockHeight: number;
  dockFolded: boolean;
  foldLeft: boolean;
  foldRight: boolean;
}

const PANEL_KEY = "dds.dock";
/** 既定はソース 8 行ぶん。選択中の項目（1〜3 行）の前後が見える最小限。 */
const DEFAULT_DOCK_HEIGHT = 190;
const DOCK_MIN_HEIGHT = 60;
const SIDE_LEFT_WIDTH = 200;
const SIDE_RIGHT_WIDTH = 320;
/** 畳んだ側に残す縦棒の幅（`ui.css` の `.dds-side.folded` と合わせる）。 */
const SIDE_FOLDED_WIDTH = 22;

/** 読めない文脈がある（サンドボックス）。**読めなくても既定で成立させる。** */
function loadPanelState(): PanelState {
  const fallback: PanelState = {
    dockHeight: DEFAULT_DOCK_HEIGHT,
    dockFolded: false,
    foldLeft: false,
    foldRight: false
  };
  try {
    const raw = window.localStorage?.getItem(PANEL_KEY);
    if (raw === null || raw === undefined) return fallback;
    const parsed = JSON.parse(raw) as Partial<PanelState>;
    return {
      dockHeight:
        typeof parsed.dockHeight === "number" && Number.isFinite(parsed.dockHeight)
          ? Math.max(DOCK_MIN_HEIGHT, parsed.dockHeight)
          : fallback.dockHeight,
      dockFolded: parsed.dockFolded === true,
      foldLeft: parsed.foldLeft === true,
      foldRight: parsed.foldRight === true
    };
  } catch {
    return fallback;
  }
}

function savePanelState(state: PanelState): void {
  try {
    window.localStorage?.setItem(PANEL_KEY, JSON.stringify(state));
  } catch {
    /* 残せなくても動作は変えない */
  }
}

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
  /**
   * 適用が通ったときに出す一言。**送る側が決める**——ホストは何が起きたかを
   * 知っているが、それを言葉にするのは画面の仕事。
   */
  private pendingStatus: string | undefined;
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
  /**
   * 適用後に選ぶ様式の**名前**（`null` なら選択を外す。`undefined` は「触らない」）。
   *
   * 行番号（`pendingSelection`）では追えない——様式の追加・削除は**行をずらす**ので、
   * 送る前に控えた行番号は当てにならない。名前なら同一ファイル内で固有（原典）。
   *
   * **突き合わせは大文字にそろえる。** `ddsName` は桁を切って trim するだけで
   * 大文字化しないので、`R rec2` と小文字で書かれたソースでは名前がそのまま出る。
   */
  private pendingSelectRecord: string | null | undefined;
  /** 条件の入力欄を開いているキーワード（`行:番号`）。 */
  private openKeywordCondition: string | undefined;
  /** ファイル・レベルの行を足した直後に、足した行を選ぶ（`addFileKeywords`）。 */
  private pendingSelectFileKeyword = false;
  /**
   * 適用後に**焦点も**移すか。行き先は選んだ様式の見出し、選べなければ `＋`。
   *
   * `pendingSelectRecord` と分けてある。**「選ぶ」と「焦点を移す」は別**——
   * 項目を置いたときは様式を選んだままにしたいが、焦点はキャンバスに残したい。
   * 一緒にすると「隣が無いときに `＋` へ戻す」（様式を全部消した場合）が
   * **`pendingSelectRecord` が undefined になって丸ごと飛ぶ**（実際にそうなっていた）。
   */
  private pendingRecordFocus = false;
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
   * いま見ている帳票のページ（1 始まり）。
   *
   * `display` に混ぜない——あちらは真偽値と倍率だけの平坦な形で、
   * 数の状態を混ぜると切替の総当たり（`toggles`）が壊れる。
   */
  private printPage = 1;
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
  private readonly addGrid: HTMLButtonElement;
  private readonly gridColor: HTMLSelectElement;
  private readonly gridLineType: HTMLSelectElement;
  /** 選んでいる罫線（`GridShape.key`）。項目の選択（`selected`）とは同時に持たない。 */
  private selectedGrid: string | undefined;
  /** 引いている途中の罫線（押した桁）と、その下書きの枠。 */
  private gridDraft: { from: CellPoint; to: CellPoint; element: HTMLElement } | undefined;
  /** 掴んでいる罫線（移動・伸縮）。 */
  private gridGesture:
    | { shape: GridShape; mode: "move" | "resize"; startX: number; startY: number; moved: boolean }
    | undefined;
  /** 罫線の様式が無いときに、様式の名前を聞いてから書くキーワード。 */
  private pendingGridKeyword: string | undefined;
  private readonly addRecord: HTMLButtonElement;
  private readonly addRecordInput: HTMLInputElement;
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

  private readonly dock: HTMLElement;
  private readonly grip: HTMLElement;
  private readonly sourcePane: HTMLElement;
  private readonly sourceTab: HTMLButtonElement;
  private readonly diagnosticsTab: HTMLButtonElement;
  private readonly diagnosticsBadge: HTMLElement;
  private readonly foldButton: HTMLButtonElement;
  private readonly sideLeft: HTMLElement;
  private readonly sideRight: HTMLElement;

  /** いま出ているソース。**モデルと同じ瞬間の内容**（ホストが 1 組で送る）。 */
  private source: readonly string[] = [];
  /** `load` の内容。**変更行の印はこれとの差**で出す。 */
  private originalSource: readonly string[] = [];
  private tab: "source" | "diagnostics" = "source";
  private panel: PanelState = loadPanelState();

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
    this.addGrid = must(root, "#dds-add-grid");
    this.gridColor = must(root, "#dds-grid-color");
    this.gridLineType = must(root, "#dds-grid-lintype");
    // **`renderOutline` の外に置く。** あそこは項目 0 件で早く返るので、
    // 中に置くと**様式が 1 つも無いファイルで `＋` が消える**（唯一の逃げ道が塞がる）。
    this.addRecord = must(root, "#dds-add-record");
    this.addRecordInput = must(root, "#dds-add-record-input");
    this.dock = must(root, ".dds-dock");
    this.grip = must(root, ".dds-grip");
    this.sourcePane = must(root, ".dds-source");
    this.sourceTab = must<HTMLButtonElement>(root, "#dds-tab-source");
    this.diagnosticsTab = must<HTMLButtonElement>(root, "#dds-tab-diagnostics");
    this.diagnosticsBadge = must(root, "#dds-tab-diagnostics .badge");
    this.foldButton = must<HTMLButtonElement>(root, "#dds-dock-fold");
    this.sideLeft = must(root, ".dds-side.left");
    this.sideRight = must(root, ".dds-side.right");
    this.wireDock(root);

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
    this.addGrid.addEventListener("click", () => this.arm("grid"));
    this.wireAddRecord();

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
        this.source = (message.source ?? []) as readonly string[];
        // **原本はここでしか採らない。** 以降の差が「読み込みから変わった行」になる。
        this.originalSource = this.source;
        this.keywordHelp = (message.keywords ?? []) as readonly DdsKeywordHelp[];
        this.mode = "idle";
        this.setStatus("");
        this.render();
        this.decideOnOpen(this.model);
        break;
      case "applied":
        this.model = message.model as RenderModel;
        this.source = (message.source ?? this.source) as readonly string[];
        this.mode = "idle";
        this.gesture = undefined;
        // 構造を変えたあとは選択を捨てる。宛先の行が消えている／ずれている。
        if (this.pendingStructural) this.selected = undefined;
        if (this.pendingSelection !== undefined) {
          this.selected = this.pendingSelection;
          this.pendingSelection = undefined;
        }
        // ファイル・レベルの行を足したら、その行（先頭のファイル・レベルの行）を選ぶ。
        if (this.pendingSelectFileKeyword) {
          this.selected = this.model?.fileKeywords[0]?.sourceLine;
          this.pendingSelectFileKeyword = false;
        }
        // 様式の追加・削除の行き先。**行はずれているので名前で引き直す。**
        if (this.pendingSelectRecord !== undefined) {
          const target = this.pendingSelectRecord?.toUpperCase();
          this.selected =
            target === undefined
              ? undefined
              : this.model?.outline.find(
                  record => record.name.toUpperCase() === target
                )?.sourceLine;
          this.pendingSelectRecord = undefined;
        }
        // 焦点は動かさない（行き先は `pendingRecordFocus` が決める）。
        this.hideAddRecord();
        this.pendingStructural = false;
        this.rejectMessage = "";
        this.pendingFocus = undefined;
        this.setStatus(this.pendingStatus ?? "");
        this.pendingStatus = undefined;
        this.render();
        break;
      case "rejected": {
        this.model = message.model as RenderModel;
        this.source = (message.source ?? this.source) as readonly string[];
        this.mode = "idle";
        this.gesture = undefined;
        this.pendingStructural = false;
        this.pendingSelection = undefined;
        // **入力欄は閉じない**（打った名前が消えると、何が悪かったのか確かめられない）。
        this.pendingSelectRecord = undefined;
        this.pendingSelectFileKeyword = false;
        // 何も変わっていないので焦点も動かさない（`render()` で消費させない）。
        this.pendingRecordFocus = false;
        this.pendingStatus = undefined;
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
          // 状態表示も理由に戻す。戻さないと「適用中…」のまま残る（実操作調査の D5）。
          this.setStatus(reason);
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
    // **帳票はページを絞る。** 後戻りするスキップでページが増える（原典 `LPI`）。
    if (model.kind === "prtf") return selectPrintPage(model, this.printPage);

    const secondary = model.secondaryScreen;
    if (!this.display.secondaryScreen || secondary === undefined) return model;
    return {
      ...model,
      canvas: secondary.canvas,
      items: secondary.items,
      windows: secondary.windows,
      gridShapes: secondary.gridShapes,
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
    this.renderSource();

    for (const toggle of this.toggles) {
      toggle.button.classList.toggle("armed", this.display[toggle.key]);
      toggle.button.setAttribute("aria-pressed", String(this.display[toggle.key]));
      // 表示装置だけのものは帳票で**出さない**（押しても何も起きないボタンを置かない）。
      // **配色は帳票にもある**——語彙は違うが（太字・下線・カラー）、
      // 「見え方を出すかどうか」という切替の意味は同じなので同じボタンに載せる。
      const displayOnly = toggle.key === "showAttributes";
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
    // 罫線は表示装置ファイルだけ（原典: DBCS を使う表示装置ファイルのキーワード）。
    for (const control of [this.addGrid, this.gridColor, this.gridLineType]) {
      control.hidden = view.kind === "prtf";
    }

    if (focusedKey !== undefined) {
      this.properties
        .querySelector<HTMLElement>(`[data-key="${focusedKey}"]`)
        ?.focus();
    }

    if (this.pendingRecordFocus) {
      this.pendingRecordFocus = false;
      // 行き先は選んだ様式の見出し。**様式が 1 つも残っていなければ `＋`**
      // ——消えた行に焦点を残さないし、body に落として行き場を失わせもしない。
      const heading =
        this.selected === undefined
          ? null
          : this.outline.querySelector<HTMLElement>(
              `li.record[data-source-line="${this.selected}"]`
            );
      (heading ?? this.addRecord).focus();
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

    // **枠は項目より先に置く**（項目の下に敷く）。枠は描くだけで、掴めない。
    const nodes: HTMLElement[] = [
      ...(model.windows ?? []).map(window => windowFrame(window)),
      ...(model.gridShapes ?? []).flatMap(shape => this.gridShapeElements(shape))
    ];
    for (const item of items) {
      // **属性文字は表示装置のもの。** 印刷には出ないので帳票では描かない。
      if (this.display.showAttributes && this.isDisplayFile()) {
        nodes.push(...attributeMarkers(item, this.dimmed(item, activeRecord)));
      }
      const element = this.buildItem(item);
      if (this.dimmed(item, activeRecord)) element.classList.add("dimmed");
      nodes.push(element);
      nodes.push(...subfileRepeats(item, element));
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
    const pages = model.pages ?? 1;
    // **ページ送りは密度と同じ帯に置く**（どちらも帳票の紙の話）。
    // 密度が出ない（升目のまま）ときでもページが複数なら帯を出す。
    if (!density && pages <= 1) {
      this.densityBox.replaceChildren();
      this.densityBox.hidden = true;
      return;
    }
    this.densityBox.hidden = false;

    const nodes: HTMLElement[] = [];

    if (pages > 1) {
      nodes.push(text("span", "label", "ページ"));
      const step = (delta: number, label: string, title: string): HTMLButtonElement => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "page-step";
        button.textContent = label;
        button.title = title;
        button.dataset.key = `page:${delta > 0 ? "next" : "prev"}`;
        button.disabled =
          delta < 0 ? this.printPage <= 1 : this.printPage >= pages;
        button.addEventListener("click", () => {
          this.printPage = Math.min(Math.max(1, this.printPage + delta), pages);
          this.render();
        });
        return button;
      };
      nodes.push(step(-1, "◀", "前のページ"));
      nodes.push(text("span", "paper page-number", `${this.printPage} / ${pages}`));
      nodes.push(step(1, "▶", "次のページ"));
    }

    if (!density) {
      this.densityBox.replaceChildren(...nodes);
      return;
    }
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
    // ウィンドウの中の項目は、枠の位置を足して描く（位置欄はウィンドウの中の値のまま）。
    const screen = screenPoint(item);
    element.style.left = `calc(var(--cell-w) * ${screen.column - 1})`;
    element.style.width = `calc(var(--cell-w) * ${item.widthCols ?? 1})`;

    // **紙の比率で描くときは位置（インチ）を使う。**
    // 行番号 × 一定の高さでは、LPI がページの途中で変わる帳票が描けない
    // （原典は変えることを認めている: 「6 LPI で 24 行、次に 8 LPI で 24 行」）。
    // LPI が 1 つなら `位置 = (行番号 - 1) ÷ LPI` なので、答えは今までと同じ。
    const paper = this.previewDensity();
    if (paper && item.inches !== undefined) {
      const perInch = EditorView.PX_PER_INCH * this.display.zoom;
      const lineHeight = perInch / (item.lpi ?? paper.lpi);
      // **`inches` は原典の数え方で「その行を印刷し終えた位置」**
      // （原典: 行番号 48 へのスキップは「48/6 = 8 インチ分スキップしてから印刷」）。
      // 描くのに要るのは**行の上端**なので、1 行分だけ戻す。
      element.style.top = `${item.inches * perInch - lineHeight}px`;
      element.style.height = `${lineHeight}px`;
    } else {
      element.style.top = `calc(var(--cell-h) * ${screen.row - 1})`;
    }
    element.title =
      `${item.label}（${item.row} 行 ${item.column} 桁` +
      `${item.origin === undefined ? "" : `・ウィンドウの中。画面では ${screen.row} 行 ${screen.column} 桁`}` +
      `${item.widthCols === undefined ? " / 幅不明" : ` / ${item.widthCols} 桁`}` +
      ` / ソース ${item.sourceLine} 行目` +
      `${item.printAppearance === undefined ? describeAppearance(item.appearance) : describePrintAppearance(item.printAppearance)}）`;

    // **配色は色だけ。桁と位置は変えない。**
    // 5250 の配色は表示装置ファイルのもの（PRTF に `DSPATR` は無い）。
    if (this.display.showColors && this.isDisplayFile()) {
      element.classList.add("colored", `c-${item.appearance.color}`);
      if (item.appearance.reverse) element.classList.add("reverse");
      if (item.appearance.underline) element.classList.add("underline");
      if (item.appearance.blink) element.classList.add("blink");
      if (item.appearance.nonDisplay) element.classList.add("non-display");
    }

    // **帳票の強調は別の語彙。** 太字（`HIGHLIGHT`）・下線（`UNDERLINE`）・
    // カラー（`COLOR`。名前の集合が画面と違う）。反転表示も明滅も非表示も無い。
    const print = item.printAppearance;
    if (this.display.showColors && print !== undefined) {
      element.classList.add("printed", `p-${print.color.toLowerCase()}`);
      if (print.bold) element.classList.add("bold");
      if (print.underline) element.classList.add("underline");
      // 装置依存の指定（`*RGB` 等）は**色を決めない**——原典が「出力装置によって
      // 異なります」と書いているので、決め打ちすると実機と違う絵になる。
      if (print.deviceColor) element.classList.add("device-color");
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
    const list = document.createElement("ul");
    list.className = "dds-tree";

    // **ファイル・レベルのキーワードを先頭に置く。** 最初の様式より前にあるので、
    // ソースの並びと同じ順になる。ここに出さないとデザイナから一切読めない。
    // **行が 1 本も無くても「ファイル」の節は出す。** 出さないと最初のキーワード（`DSPSIZ`・帳票の `LPI` 等）を
    // 足す入口がエディタに無く、テキストで書くしかなかった（実操作調査の D1）。空のときは足すための行を 1 つ置く。
    {
      // **`record` を付けない。** 様式を選ぶ側が拾ってしまう（様式ではない）。
      const heading = text("li", "file-level", "");
      heading.append(text("span", "label", "ファイル"));
      list.appendChild(heading);

      const children = document.createElement("ul");
      const entries =
        model.fileKeywords.length > 0
          ? model.fileKeywords
          : [{ sourceLine: NEW_FILE_KEYWORD_LINE, keywords: "（キーワードなし・ここから足す）" }];
      for (const entry of entries) {
        const row = document.createElement("li");
        // **`item` にしない。** 項目を選ぶ側（一覧の走査・キー移動）が
        // ファイル・レベルの行まで拾ってしまう。これらは項目ではない。
        row.className = "file-keyword";
        row.tabIndex = 0;
        row.dataset.sourceLine = String(entry.sourceLine);
        if (entry.sourceLine === this.selected) row.classList.add("selected");
        row.append(text("span", "label", entry.keywords));
        row.title = entry.sourceLine === NEW_FILE_KEYWORD_LINE ? "ファイル・レベルのキーワードを足す" : `${entry.sourceLine} 行目`;
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
      // **名前のある様式だけ消せる。**「（様式の外）」は様式ではない（消す対象が無い）。
      // 見出しの中に置くので Tab で届き、マウス専用にはならない。
      if (record.name.length > 0) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "record-remove";
        remove.textContent = "✕";
        remove.title = `${record.name} を削除（中の項目 ${record.items.length} 件も消えます・元に戻せます）`;
        remove.addEventListener("click", event => {
          event.stopPropagation();
          this.removeRecord(record);
        });
        heading.appendChild(remove);

        // **潜在フィールドを足す**（位置なし・使用 H。キャンバスには描かれないので一覧から足す。利用者の決定）。
        if (this.options.askItem !== undefined && this.model?.kind !== "prtf") {
          const addHidden = document.createElement("button");
          addHidden.type = "button";
          addHidden.className = "record-add-hidden";
          addHidden.textContent = "＋ 潜在";
          addHidden.title = `${record.name} に潜在フィールド（使用 H・位置なし）を足す`;
          addHidden.addEventListener("click", event => {
            event.stopPropagation();
            void this.addHiddenField(record.name);
          });
          heading.appendChild(addHidden);
        }
      }
      // 項目は見出しの**中**（入れ子の ul）にあるので、クリックもキーも上がってくる。
      // **一番内側の li が自分かどうか**で見分ける（`.label` は項目側にもあるので使えない）。
      // **見出しの中のボタンは除く。** 見出しは `Enter` / `Space` を「様式を選ぶ」に
      // 使うので、除かないと `✕` にフォーカスして `Enter` を押しても
      // **選択に化けてボタンが押せない**（`preventDefault` で click も出なくなる）。
      // クリックは `stopPropagation` で止まるが、キーは止まらないので**ここで除く**。
      const isOwn = (target: EventTarget | null): boolean =>
        target instanceof HTMLElement &&
        target.closest("li") === heading &&
        target.closest("button") === null;

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
      // **項目を様式へドラッグして移す**（実操作調査の D15・利用者の決定）。見出しの中（項目の上）に落としても同じ。
      if (record.name.length > 0) {
        heading.addEventListener("dragover", event => {
          if (!event.dataTransfer?.types.includes(DRAG_ITEM_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          heading.classList.add("drop-target");
        });
        heading.addEventListener("dragleave", event => {
          if (event.relatedTarget instanceof Node && heading.contains(event.relatedTarget)) return;
          heading.classList.remove("drop-target");
        });
        heading.addEventListener("drop", event => {
          const raw = event.dataTransfer?.getData(DRAG_ITEM_TYPE);
          heading.classList.remove("drop-target");
          if (!raw) return;
          event.preventDefault();
          event.stopPropagation();
          const sourceLine = Number(raw);
          if (record.items.some(item => item.sourceLine === sourceLine)) return; // 同じ様式の中では何もしない
          const moved = (this.model?.outline ?? []).flatMap(entry => entry.items).find(item => item.sourceLine === sourceLine);
          this.pendingStatus = `${moved?.label || "項目"} を様式 ${record.name} へ移しました`;
          this.send({ kind: "moveToRecord", sourceLine, recordName: record.name });
        });
      }
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
    // 別の様式の見出しへドラッグして移す（D15）。
    row.draggable = true;
    row.addEventListener("dragstart", event => {
      event.dataTransfer?.setData(DRAG_ITEM_TYPE, String(item.sourceLine));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });

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
    const grid = this.selectedGridShape();
    if (grid !== undefined) {
      this.renderGridProperties(grid);
      return;
    }
    const fileKeyword = model.fileKeywords.find(
      candidate => candidate.sourceLine === this.selected
    );
    if (fileKeyword !== undefined) {
      this.renderFileKeywordProperties(fileKeyword);
      return;
    }
    if (this.selected === NEW_FILE_KEYWORD_LINE && model.fileKeywords.length === 0) {
      this.renderFileKeywordProperties({
        sourceLine: NEW_FILE_KEYWORD_LINE,
        keywords: "",
        condition: { kind: "none" }
      } as unknown as RenderModel["fileKeywords"][number]);
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
      // **何が一緒に変わるかを書く。** 直す前は「SFLCTL 等は追随しません」と
      // 出していたが、`SFLCTL` が指すのは項目ではなく**様式**で、
      // 項目の改名では元から影響しない（断り書き自体が誤っていた）。
      nodes.push(
        text(
          "div",
          "dds-note",
          this.model?.kind === "prtf"
            ? "名前を変えると、この項目を指すキーワード（&名前）も一緒に変わります"
            : "名前を変えると、この項目を指すキーワード（&名前 / CSRLOC / HLPARA(*FLD)）も" +
              "一緒に変わります"
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
    nodes.push(
      text(
        "div",
        "dds-note",
        entry.sourceLine === NEW_FILE_KEYWORD_LINE ? "最初の様式の前に行を足します" : `${entry.sourceLine} 行目`
      )
    );
    this.properties.replaceChildren(...nodes);
  }

  private renderRecordProperties(record: RenderModel["outline"][number]): void {
    const nodes: HTMLElement[] = [
      text(
        "div",
        "dds-record-title",
        record.name.length > 0 ? `様式 ${record.name}` : "（様式の外）"
      )
    ];

    // **様式にも名前の欄を出す。** 出す前は改名するのにテキストエディタが要り、
    // 手で直すと `SFLCTL` などの参照が置き去りになった（実機が通さない形になる）。
    // 「（様式の外）」＝ 最初の様式より前のキーワード行には名前が無いので出さない。
    if (record.name.length > 0) {
      const table = document.createElement("table");
      table.className = "dds-props";
      const row = document.createElement("tr");
      const label = document.createElement("th");
      label.textContent = "名前";
      const cell = document.createElement("td");
      cell.appendChild(this.recordNameInput(record));
      row.append(label, cell);
      table.appendChild(row);
      nodes.push(table);
    }

    nodes.push(this.keywordSection(record.sourceLine, record.keywords, "record"));
    const conditional = this.describeRecordConditionalKeywords(record.sourceLine);
    if (conditional !== undefined) nodes.push(conditional);
    if (record.keywords.trim().length === 0) {
      nodes.push(text("div", "dds-note", "この様式にはレコード・レベルのキーワードがありません"));
    }
    if (record.name.length > 0) {
      nodes.push(
        text(
          "div",
          "dds-note",
          "名前を変えると、この様式を指すキーワード（SFLCTL / ERASE / PASSRCD / " +
            "HLPRCD / MNUBARDSP / MNUBARCHC）も一緒に変わります"
        )
      );
    }
    nodes.push(text("div", "dds-reject", this.rejectMessage));
    this.properties.replaceChildren(...nodes);
  }

  /**
   * 様式の名前の入力欄。
   *
   * `attributeInput` と**同じ約束**（Enter で確定 / Escape で戻す / 抜けたら確定・
   * 同じ値なら送らない）にそろえる。送る編集だけが違う。
   */
  private recordNameInput(record: RenderModel["outline"][number]): HTMLInputElement {
    const input = document.createElement("input");
    input.value = record.name;
    input.dataset.key = "recordName";
    input.maxLength = 10;

    let committed = record.name;
    const commit = (): void => {
      if (input.value === committed) return;
      committed = input.value;
      this.pendingFocus = "recordName";
      this.pendingStatus = this.describeRecordRenameFollow(record.name);
      this.send({ kind: "renameRecord", sourceLine: record.sourceLine, name: input.value });
    };

    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        input.value = committed;
        input.blur();
      }
    });
    input.addEventListener("blur", commit);
    return input;
  }

  /** その様式を指している参照の件数（0 件なら知らせない）。 */
  private describeRecordRenameFollow(from: string): string | undefined {
    const model = this.model;
    if (!model || from.trim().length === 0) return undefined;
    const target = from.trim().toUpperCase();

    const areas = [
      ...model.fileKeywords.map(entry => entry.keywords),
      ...model.outline.flatMap(entry => [
        entry.keywords,
        ...entry.items.map(item => item.attributes.keywords ?? "")
      ])
    ];
    const count = areas.reduce(
      (total, keywords) =>
        total +
        findRecordReferences(keywords).filter(
          reference => reference.name.toUpperCase() === target
        ).length,
      0
    );
    return count === 0 ? undefined : `${count} か所の参照も一緒に変えました`;
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

        // **条件を付ける**（`31 SFLDSP` / `40 COLOR(RED)`）。そのキーワードだけを条件つきの行へ移す
        // （実操作調査の D10・D8。サブファイルの SFLDSP / SFLCLR が組めなかった）。ファイル・レベルは対象外。
        if (level !== "file") {
          const condition = document.createElement("button");
          condition.type = "button";
          condition.className = "kw-cond";
          condition.textContent = "条件";
          condition.title = `${entry.name} に条件標識を付ける（その行へ分けて書きます）`;
          condition.dataset.key = `kwc:${index}`;
          condition.addEventListener("click", () => {
            this.openKeywordCondition = this.openKeywordCondition === key ? undefined : key;
            this.render();
          });
          chips.appendChild(condition);
        }
      }

      if (this.openKeywordCondition === key && entry.kind === "keyword") {
        const input = document.createElement("input");
        input.className = "kw-cond-input";
        input.dataset.key = "kw:cond-input";
        input.placeholder = `${entry.name} の条件（例: 31 / N40 41 / 50, 60）`;
        input.addEventListener("keydown", event => {
          if (event.key === "Escape") {
            event.preventDefault();
            this.openKeywordCondition = undefined;
            this.render();
            return;
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          const parsed = parseConditionText(input.value);
          if (!parsed.ok || parsed.screenSize !== undefined || parsed.groups.length === 0) {
            this.setStatus(parsed.ok ? "標識を入れてください（例: 31 / N40 41）" : parsed.message);
            return;
          }
          this.openKeywordCondition = undefined;
          this.pendingStatus = `${entry.name} を条件 ${formatConditionText(parsed.groups)} の行へ分けました`;
          this.send({ kind: "conditionKeyword", sourceLine, index, condition: parsed.groups });
        });
        chips.appendChild(input);
        queueMicrotask(() => input.focus());
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
      // **外された欄からは確定しない。** 再描画で作り替えられた欄は文書に
      // 繋がっておらず、その値はもう利用者の意思ではない。ここを見ないと、
      // 拒否 → フォーカスは残る → 次の再描画で外れる → blur → 同じ編集を再送
      // という往復になる（拒否の分岐にある注意書きと同じ罠の裏側）。
      // 実際、これが「関係無い操作をした瞬間に選択が飛ぶ」形で表に出た。
      if (!raw.isConnected) return;
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

      // **総称のまま送らない。** 原典はキー番号をまとめて `CFnn` と書くので、
      // そのまま大文字にすると `CFNN` になり、実機がコンパイルを通さない。
      // 番号の場所より前だけを残して、続きを打ってもらう（入力欄は閉じない）。
      //
      // 判定は**表の名前**で行う（打たれた綴りではない）。`cfnn` と小文字で
      // 打たれても総称であることに変わりはなく、`CF03` は総称ではない。
      const prefix = help === undefined ? undefined : genericKeywordPrefix(help.name);
      if (prefix !== undefined && help !== undefined && name === help.name.toUpperCase()) {
        input.value = prefix;
        input.focus();
        const range = genericKeywordRange(help);
        this.setStatus(
          range === undefined
            ? `${prefix} に続けて番号を入れてください`
            : `${prefix}${range.from} - ${prefix}${range.to} の番号を入れてください`
        );
        return;
      }

      // **書けないレベルのキーワードは足さない**（実操作調査の D2。様式に `DSPSIZ` を足せていた。実機は CPD7486）。
      // 判定は検証の `keyword-wrong-level` と同じ表（原典から生成し実機で 7 通り確かめたもの）で、表に無いものは止めない。
      const wrong = keywordsNotAllowedAt(this.model?.kind === "prtf" ? "PRTF" : "DSPF", name, level);
      if (wrong.length > 0) {
        this.setStatus(`${name} は${level === "file" ? "ファイル" : level === "record" ? "様式" : "項目"}には書けません（書ける場所: ${(levelsOf(this.model?.kind === "prtf" ? "PRTF" : "DSPF", name) ?? []).map(levelLabel).join(" / ")}）`);
        input.focus();
        return;
      }

      // **括弧の中が必須のキーワードは確定しない。** `NAME()` のまま書くと実機は作成しない（CPD7512 / CPD7498。D3）。
      // 生テキストの欄に `NAME()` を入れて括弧の中に焦点を置き、続きを打って Enter で確定してもらう。
      // 括弧ごと省略できるもの（`PRINT` / `CA03` / `SFLEND`）は名前だけで確定する。原典に無いものも確定しない側に倒す。
      if (help === undefined || requiresParameters(help)) {
        const raw = wrap.closest(".kw-section")?.querySelector<HTMLInputElement>('input[data-key="kw:raw"]');
        if (raw) {
          raw.value = `${keywords} ${name}()`.trim();
          raw.focus();
          raw.setSelectionRange(raw.value.length - 1, raw.value.length - 1);
          this.setStatus(`${name} の値を括弧の中に入れて Enter で確定します`);
          return;
        }
      }
      this.sendKeywords(sourceLine, `${keywords} ${name}`.trim());
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
    if (sourceLine === NEW_FILE_KEYWORD_LINE) {
      // 行を足す（宛先の行がまだ無い）。足したあとは足した行を選ぶ（`applied`）。
      this.pendingSelectFileKeyword = true;
      this.send({ kind: "addFileKeywords", keywords });
      return;
    }
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
    return this.conditionalKeywordRows((placed?.keywordGroups ?? []).slice(1));
  }

  /**
   * 様式の、**条件つきの行に分かれたキーワード**（`31 SFLDSP`）。項目と同じ欄で出し、条件を直せる。
   * 様式は絵に描かれないので、ソースから論理単位を引き直して群を取る。
   * 条件の無い継続行は様式のキーワードの続きなので出さない。
   */
  private describeRecordConditionalKeywords(sourceLine: number): HTMLElement | undefined {
    const unit = toLogicalUnits(this.source).find(candidate => candidate.sourceLine === sourceLine);
    if (!unit) return undefined;
    const groups = resolveKeywordGroups(unit)
      .slice(1)
      .filter(group => group.conditioning.kind !== "none");
    return this.conditionalKeywordRows(groups);
  }

  private conditionalKeywordRows(groups: readonly KeywordGroup[]): HTMLElement | undefined {
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
      // 属性文字は画面だけ（帳票には無い。実操作調査の帳票 P4）。
      `${placed.occupancy.start} 〜 ${placed.occupancy.end} 桁${model.kind === "prtf" ? "" : "（属性文字を含む）"}`
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
    // **帳票の使用は 空白・O・P だけ**（原典。画面の選択肢を出していた。実操作調査の帳票 P2）。
    const choices: ReadonlyArray<readonly [string, string]> =
      this.model?.kind === "prtf"
        ? [
            ["", "（指定なし＝出力専用）"],
            ["O", "O 出力専用"],
            ["P", "P プログラム - システム間"]
          ]
        : [
            ["", "（指定なし）"],
            ["I", "I 入力"],
            ["O", "O 出力"],
            ["B", "B 両用"],
            ["H", "H 潜在"]
          ];
    for (const [value, label] of choices) {
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
    // **名前を変えると他の行も変わる。** 何行変わったかを出さないと、
    // 押した人には「1 つ直したはずなのにソースが増えて動いた」ようにしか見えない。
    this.pendingStatus =
      key === "name" ? this.describeRenameFollow(item.attributes.name ?? "") : undefined;
    this.send({
      kind: "setAttributes",
      sourceLine: item.sourceLine,
      attributes
    } as DdsEdit);
  }

  /**
   * その名前を指している参照の件数（0 件なら知らせない）。
   *
   * 数え方は core（`findFieldReferences`）に任せる。**ここで数え直すと、
   * 実際に書き換わる箇所と件数が食い違う。**
   */
  private describeRenameFollow(from: string): string | undefined {
    const model = this.model;
    if (!model || from.trim().length === 0) return undefined;
    const target = from.trim().toUpperCase();

    const areas = [
      ...model.fileKeywords.map(entry => entry.keywords),
      ...model.outline.flatMap(record => [
        record.keywords,
        ...record.items.map(item => item.attributes.keywords ?? "")
      ])
    ];
    const count = areas.reduce(
      (total, keywords) =>
        total +
        findFieldReferences(keywords).filter(
          reference => reference.name.toUpperCase() === target
        ).length,
      0
    );
    return count === 0 ? undefined : `${count} か所の参照も一緒に変えました`;
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

  // ---------------------------------------------------------------- 下部ドック

  /**
   * ドックと左右ペインの操作を繋ぐ。
   *
   * **編集中はタブを勝手に切り替えない。** 編集の途中では一時的なエラーが普通に出る
   * （項目をドラッグしている最中に右端をはみ出す等）ので、追従すると見ていたソースを奪う。
   * 判断するのは**開いたときだけ**（`decideOnOpen`）。
   */
  private wireDock(root: HTMLElement): void {
    this.grip.addEventListener("pointerdown", event => {
      event.preventDefault();
      this.grip.setPointerCapture(event.pointerId);
      const startY = event.clientY;
      const startHeight = this.panel.dockHeight;
      const move = (moved: PointerEvent): void => {
        const limit = Math.max(DOCK_MIN_HEIGHT, window.innerHeight - 200);
        this.panel.dockHeight = Math.max(
          DOCK_MIN_HEIGHT,
          Math.min(limit, startHeight + (startY - moved.clientY))
        );
        this.panel.dockFolded = false;
        this.applyPanels();
      };
      const up = (): void => {
        this.grip.removeEventListener("pointermove", move);
        this.grip.removeEventListener("pointerup", up);
        savePanelState(this.panel);
      };
      this.grip.addEventListener("pointermove", move);
      this.grip.addEventListener("pointerup", up);
    });
    this.grip.addEventListener("dblclick", () => this.setDockFolded(!this.panel.dockFolded));

    this.foldButton.addEventListener("click", () => this.setDockFolded(!this.panel.dockFolded));
    must<HTMLButtonElement>(root, "#dds-dock-half").addEventListener("click", () =>
      this.setDockHeight(Math.round(window.innerHeight * 0.35))
    );
    must<HTMLButtonElement>(root, "#dds-dock-max").addEventListener("click", () =>
      this.setDockHeight(Math.max(DOCK_MIN_HEIGHT, window.innerHeight - 200))
    );

    this.sourceTab.addEventListener("click", () => this.showTab("source"));
    this.diagnosticsTab.addEventListener("click", () => this.showTab("diagnostics"));

    must<HTMLButtonElement>(root, "#dds-fold-left").addEventListener("click", () => {
      this.panel.foldLeft = !this.panel.foldLeft;
      this.applyPanels();
      savePanelState(this.panel);
    });
    must<HTMLButtonElement>(root, "#dds-fold-right").addEventListener("click", () => {
      this.panel.foldRight = !this.panel.foldRight;
      this.applyPanels();
      savePanelState(this.panel);
    });

    this.applyPanels();
  }

  private setDockHeight(height: number): void {
    this.panel.dockHeight = height;
    this.panel.dockFolded = false;
    this.applyPanels();
    savePanelState(this.panel);
  }

  private setDockFolded(folded: boolean): void {
    this.panel.dockFolded = folded;
    this.applyPanels();
    savePanelState(this.panel);
  }

  private showTab(tab: "source" | "diagnostics"): void {
    this.tab = tab;
    this.sourceTab.setAttribute("aria-selected", String(tab === "source"));
    this.diagnosticsTab.setAttribute("aria-selected", String(tab === "diagnostics"));
    this.sourcePane.hidden = tab !== "source";
    this.diagnostics.hidden = tab !== "diagnostics";
    // タブを選んだのに何も見えないのは操作の取りこぼしになる
    if (this.panel.dockFolded) this.setDockFolded(false);
    else this.revealSelectedSource();
  }

  private applyPanels(): void {
    const app = this.grip.parentElement;
    app?.classList.toggle("dock-folded", this.panel.dockFolded);
    this.dock.style.flex = this.panel.dockFolded ? "none" : `0 0 ${this.panel.dockHeight}px`;
    this.foldButton.textContent = this.panel.dockFolded ? "▴" : "▾";
    this.foldButton.title = this.panel.dockFolded ? "広げる" : "畳む";
    this.sideLeft.classList.toggle("folded", this.panel.foldLeft);
    this.sideRight.classList.toggle("folded", this.panel.foldRight);
  }

  /**
   * キャンバスが**桁を描くのに要る幅**。`cellWidth` は実測値を使う
   * （決め打ちにすると字体が変わったときに静かにずれる）。
   */
  private requiredCanvasWidth(model: RenderModel): number {
    const gutter = 3 * 13; // --gutter: 3em / 13px
    // **倍率を掛けない実測値で数える。** ズームは「細かく見たい」という表示の好みで、
    // 拡大したせいで一覧やプロパティが消えるのは利用者と喧嘩する。畳むかどうかは
    // **そのファイルの桁数**（132 桁なら足りない、80 桁なら足りる）で決める。
    return model.canvas.columns * this.measuredWidth + gutter + 24 + 2;
  }

  /**
   * 開いたときだけ決めるもの（決定 #3 / #4）。**以降は勝手に動かさない。**
   *
   * - 診断にエラーがあれば検証タブで開く（無ければソース）
   * - 幅が足りなければ左右ペインを畳んでおく
   */
  private decideOnOpen(model: RenderModel): void {
    // **`RenderDiagnostic` に severity は無い**（code / message / sourceLine のみ）ので、
    // 「エラーがあれば」は「指摘があれば」で読む。区別が要るなら core 側に足す話になる。
    this.showTab(model.diagnostics.length > 0 ? "diagnostics" : "source");

    // **両方向に決める。** 畳む方だけだと、一度 132 桁を開いたあと 80 桁に戻しても
    // 畳んだままになり、以後どのファイルでも左右が消えたままになる（実際に踏んだ）。
    // 利用者が自分で畳んだ分（保存された値）は残す——幅が足りていても畳んだままにする。
    //
    // **足りない分だけ畳み、左から畳む。** 右はプロパティとキーワードの入力欄で、
    // ここを畳むと編集する手段そのものが消える。左は一覧＝辿る手段なので、
    // 畳んでもキャンバスから直接選べる。両方畳むのは左だけでは足りないときに限る。
    const width = this.grip.parentElement?.clientWidth ?? window.innerWidth;
    const need = this.requiredCanvasWidth(model);
    const saved = loadPanelState();
    const fits = (left: boolean, right: boolean): boolean =>
      width - (left ? SIDE_FOLDED_WIDTH : SIDE_LEFT_WIDTH)
            - (right ? SIDE_FOLDED_WIDTH : SIDE_RIGHT_WIDTH) >= need;

    const foldLeft = saved.foldLeft || !fits(false, false);
    const foldRight = saved.foldRight || !fits(foldLeft, false);
    this.panel.foldLeft = foldLeft;
    this.panel.foldRight = foldRight;
    this.applyPanels();
  }

  /**
   * ソース面。**表示専用**（決定 #2）——行を押すとホストのエディタへ飛ぶ。
   *
   * 変更行は `load` の内容との差で塗る。**ここ以外が変わっていないこと**が見どころなので、
   * 塗る範囲を広げない。
   */
  private renderSource(): void {
    if (this.source.length === 0) {
      this.sourcePane.replaceChildren(text("div", "empty", "ソースがありません"));
      return;
    }
    const rows = this.source.map((line, index) => {
      const row = document.createElement("div");
      row.className = "line";
      row.dataset.line = String(index + 1);
      if (line !== this.originalSource[index]) row.classList.add("changed");
      if (index + 1 === this.selected) row.classList.add("current");
      if (this.host.canOpenSource) {
        row.classList.add("jumpable");
        row.addEventListener("click", () =>
          this.bridge.post({ type: "openSource", sourceLine: index + 1 })
        );
      }
      row.append(text("span", "no", String(index + 1)), text("span", "text", line));
      return row;
    });
    this.sourcePane.replaceChildren(...rows);
    this.updateDiagnosticsBadge();
    this.revealSelectedSource();
  }

  /**
   * 件数バッジ。**常設リストを畳んだ代わりの気付き手段**なので、
   * タブ行が畳んでも残ることと対で意味を持つ。
   */
  private updateDiagnosticsBadge(): void {
    const count = this.model?.diagnostics.length ?? 0;
    this.diagnosticsBadge.textContent = count === 0 ? "" : String(count);
    this.diagnosticsBadge.classList.toggle("has-error", count > 0);
  }

  /** 選んだ項目の行までスクロールする。**追従しないなら 8 行に意味が無い。** */
  private revealSelectedSource(): void {
    if (this.tab !== "source" || this.panel.dockFolded || this.selected === undefined) return;
    this.sourcePane
      .querySelector(`.line[data-line="${this.selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
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
    if (this.placing === "grid") {
      this.startGridDraft(event);
      return;
    }
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

    // **罫線を掴む。** 線そのもの（または選んだ罫線のつまみ）を押したときだけ。
    const gridElement = target?.closest<HTMLElement>("[data-grid-key]") ?? null;
    if (gridElement !== null) {
      this.grabGrid(gridElement, event);
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
      rowFromSpacing: current.dataset.rowFromSpacing === "true",
      ...this.itemWindow(sourceLine)
    };
    this.mode = target?.dataset.role === "resize" ? "resizing" : "selecting";
    event.preventDefault();
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.gridDraft !== undefined) {
      this.gridDraft.to = this.cellAt(event);
      placeGridDraft(this.gridDraft.element, geometryFromCells(this.gridDraft.from, this.gridDraft.to));
      return;
    }
    if (this.gridGesture !== undefined) {
      this.previewGridGesture(event);
      return;
    }
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
      const offset = gesture.window?.origin ?? { row: 0, column: 0 };
      gesture.element.style.left = `calc(var(--cell-w) * ${target.column + offset.column - 1})`;
      gesture.element.style.top = `calc(var(--cell-h) * ${target.row + offset.row - 1})`;
      return;
    }

    if (this.mode === "resizing") {
      const width = this.resizeTarget(gesture, deltaX);
      gesture.element.style.width = `calc(var(--cell-w) * ${width})`;
    }
  }

  private onPointerUp(event: PointerEvent): void {
    if (this.gridDraft !== undefined) {
      const draft = this.gridDraft;
      this.gridDraft = undefined;
      draft.element.remove();
      this.placing = null;
      this.updateArmed();
      this.drawGrid(geometryFromCells(draft.from, this.cellAt(event)));
      return;
    }
    if (this.gridGesture !== undefined) {
      this.finishGridGesture(event);
      return;
    }
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
      this.gridDraft?.element.remove();
      this.gridDraft = undefined;
      this.placing = null;
      this.updateArmed();
      this.select(undefined);
      this.setStatus("");
      return;
    }
    if (this.mode === "idle" && this.selectedGrid !== undefined) {
      this.onGridKey(event);
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
    const canvas = this.itemWindow(item.sourceLine).window?.bounds ?? this.canvasSize();
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
    this.setStatus(
      this.placing === null
        ? ""
        : this.placing === "grid"
          ? "キャンバスをドラッグした範囲に罫線を引きます（Esc で取り消し）"
          : "キャンバスをクリックすると置きます（Esc で取り消し）"
    );
  }

  private updateArmed(): void {
    this.addField.classList.toggle("armed", this.placing === "field");
    this.addConstant.classList.toggle("armed", this.placing === "constant");
    this.addGrid.classList.toggle("armed", this.placing === "grid");
    this.canvas.classList.toggle("placing", this.placing !== null);
  }

  /** 潜在フィールドを様式の末尾に足す。名前・長さ・型はホストが聞く（使用は H、位置なし）。 */
  private async addHiddenField(recordName: string): Promise<void> {
    const ask = this.options.askItem;
    if (ask === undefined) return;
    const item = await ask("hidden");
    if (item === undefined) {
      this.setStatus("");
      return;
    }
    this.pendingStatus = `様式 ${recordName} に潜在フィールドを足しました`;
    this.send({ kind: "add", recordName, item: { ...item, kind: "field", usage: "H" } } as DdsEdit);
  }

  private async place(event: PointerEvent): Promise<void> {
    const kind = this.placing;
    const ask = this.options.askItem;
    if (kind === null || kind === "grid" || ask === undefined) return;

    const screen = this.cellAt(event);
    const record = this.recordAt(screen);
    if (record === undefined) return;
    // ウィンドウに表示される様式なら、押した画面の位置をウィンドウの中の位置に直す。
    const window = this.windowOfRecord(record);
    const at = window === undefined ? screen : toWindowPoint(window, screen);
    this.placing = null;
    this.updateArmed();

    const item = await ask(kind, at);
    if (item === undefined) {
      this.setStatus(""); // 取り消し。何も置かない。
      return;
    }

    this.pendingStructural = true;
    // **見出しを選んで置いたなら、置いたあとも選んだままにする。**
    // `pendingStructural` は行がずれるので選択を捨てるが、それだと足した様式が
    // 置いた直後に選択から外れ、一覧のどこで作業していたか分からなくなる。
    // 選択から来ていないとき（行の見当で決まったとき）は**触らない**
    // ——置くたびに選択が生まれると、次のクリックの行き先が静かに変わる。
    if (this.selectedRecordHeading() === record) this.pendingSelectRecord = record;
    // **どの様式に入ったかを必ず言う。** 見出しを選んでいないときは行の見当で決まるので、
    // 黙っていると別の様式に入っても気づけない（実操作調査の D14）。
    this.pendingStatus = `様式 ${record} に置きました`;
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
    // 行がずれるものは選択を捨てる（宛先の行が消えている／ずれている）。
    this.pendingStructural =
      edit.kind === "add" ||
      edit.kind === "remove" ||
      edit.kind === "addRecord" ||
      edit.kind === "addFileKeywords" ||
      edit.kind === "moveToRecord" ||
      edit.kind === "removeRecord" ||
      edit.kind === "addGrid" ||
      (edit.kind === "setGridKeyword" && edit.keyword.trim().length === 0);
    this.setStatus("適用中…");
    this.bridge.post({ type: "edit", edits: [edit] });
  }

  // ---- 罫線（GRDBOX / GRDLIN。2026-09-27 利用者の決定）------------------------

  /** 罫線を描く要素。線 1 本ごとに 1 つ。選んでいればつまみも足す。 */
  private gridShapeElements(shape: GridShape): HTMLElement[] {
    const selected = shape.key === this.selectedGrid;
    const elements = shape.lines.map(line => {
      const element = gridLine(line);
      element.dataset.gridKey = shape.key;
      element.classList.toggle("selected", selected);
      element.title = `${shape.raw}（様式 ${shape.recordName}・ソース ${shape.sourceLine} 行目）`;
      return element;
    });
    if (selected) {
      const handle = document.createElement("div");
      handle.className = "dds-grid-handle";
      handle.dataset.gridKey = shape.key;
      handle.dataset.role = "grid-resize";
      const end = gridEnd(shape.geometry);
      handle.style.left = `calc(var(--cell-w) * ${end.column})`;
      handle.style.top = `calc(var(--cell-h) * ${end.row})`;
      elements.push(handle);
    }
    return elements;
  }

  private selectedGridShape(): GridShape | undefined {
    if (this.selectedGrid === undefined) return undefined;
    return ((this.view ?? this.model)?.gridShapes ?? []).find(shape => shape.key === this.selectedGrid);
  }

  private selectGrid(key: string | undefined): void {
    this.selected = undefined;
    this.selectedGrid = key;
    this.render();
  }

  /** 描いている画面サイズ（`*DS3` / `*DS4` の位置を書き換えるときにどちらの組かを決める）。 */
  private gridScreenSize(): { size: { rows: number; columns: number } } {
    return { size: (this.view ?? this.model)?.canvas ?? this.canvasSize() };
  }

  private startGridDraft(event: PointerEvent): void {
    const from = this.cellAt(event);
    const element = document.createElement("div");
    element.className = "dds-grid-draft";
    placeGridDraft(element, geometryFromCells(from, from));
    this.canvas.appendChild(element);
    this.gridDraft = { from, to: from, element };
    event.preventDefault();
  }

  /**
   * 引いた罫線を様式に書く。入れる様式は利用者の決定どおり:
   * 一覧で罫線の様式を選んでいればそこ、選んでいなければ罫線の様式が 1 つならそこ、
   * 1 つも無ければ名前を聞いて作る。2 つ以上あって選んでいなければ、選ぶよう言う。
   */
  private drawGrid(geometry: GridGeometry): void {
    const keyword = buildGridKeyword(geometry, {
      ...(this.gridColor.value ? { color: this.gridColor.value as GridColor } : {}),
      ...(this.gridLineType.value ? { lineType: this.gridLineType.value as GridLineType } : {})
    });
    const gridRecords = (this.view ?? this.model)?.gridRecords ?? [];
    const heading = this.selectedRecordHeading()?.toUpperCase();
    const record =
      heading !== undefined && gridRecords.includes(heading)
        ? heading
        : gridRecords.length === 1
          ? gridRecords[0]
          : undefined;

    if (record !== undefined) {
      this.pendingStatus = `様式 ${record} に罫線を引きました`;
      this.send({ kind: "addGrid", recordName: record, keyword });
      return;
    }
    if (gridRecords.length > 1) {
      this.setStatus(`罫線を入れる様式（${gridRecords.join(" / ")}）を一覧で選んでから引いてください`);
      return;
    }
    // 罫線の様式（GRDRCD）が無い。名前を聞く（一覧の見出しの ＋ と同じ入力欄）。
    this.pendingGridKeyword = keyword;
    this.addRecordInput.hidden = false;
    this.addRecordInput.value = "";
    this.addRecordInput.placeholder = "罫線の様式名（GRDRCD）";
    this.addRecordInput.focus();
    this.setStatus("罫線の様式（GRDRCD）がありません。様式の名前を入れて Enter で作ります（Esc で取り消し）");
  }

  private grabGrid(element: HTMLElement, event: PointerEvent): void {
    const key = element.dataset.gridKey;
    if (key !== this.selectedGrid) this.selectGrid(key);
    const shape = this.selectedGridShape();
    if (shape === undefined) return;
    this.gridGesture = {
      shape,
      mode: element.dataset.role === "grid-resize" ? "resize" : "move",
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    event.preventDefault();
  }

  /** 掴んだ罫線の移動量（桁・行）から、動かした後の形。画面の外へは出さない。 */
  private gridGestureGeometry(event: PointerEvent): GridGeometry | undefined {
    const gesture = this.gridGesture;
    if (gesture === undefined) return undefined;
    const rows = Math.round((event.clientY - gesture.startY) / this.lineHeight);
    const columns = Math.round((event.clientX - gesture.startX) / this.cellWidth);
    if (rows === 0 && columns === 0) return undefined;
    return gesture.mode === "move"
      ? moveGrid(gesture.shape.geometry, rows, columns, this.canvasSize())
      : resizeGrid(gesture.shape.geometry, rows, columns, this.canvasSize());
  }

  private previewGridGesture(event: PointerEvent): void {
    const geometry = this.gridGestureGeometry(event);
    let draft = this.canvas.querySelector<HTMLElement>(".dds-grid-draft");
    if (geometry === undefined) {
      draft?.remove();
      return;
    }
    this.gridGesture!.moved = true;
    if (draft === null) {
      draft = document.createElement("div");
      draft.className = "dds-grid-draft";
      this.canvas.appendChild(draft);
    }
    placeGridDraft(draft, geometry);
  }

  private finishGridGesture(event: PointerEvent): void {
    const gesture = this.gridGesture!;
    // 形は**掴みを外す前に**求める（外した後は移動量の起点が無い）。
    const geometry = this.gridGestureGeometry(event);
    this.gridGesture = undefined;
    this.canvas.querySelector(".dds-grid-draft")?.remove();
    if (!gesture.moved || geometry === undefined) return;
    this.writeGrid(gesture.shape, geometry);
  }

  /** 罫線を書き換える。色・線種は `style` に鍵があるときだけ変える。 */
  private writeGrid(
    shape: GridShape,
    geometry: GridGeometry,
    style: { color?: GridColor | undefined; lineType?: GridLineType | undefined } = {}
  ): void {
    const keyword = rewriteGridKeyword(shape.raw, geometry, this.gridScreenSize(), style);
    if (keyword === shape.raw) return;
    this.send({ kind: "setGridKeyword", sourceLine: shape.recordLine, index: shape.index, keyword });
  }

  /** 罫線を選んでいるときのキー。Delete で消し、矢印で 1 桁・1 行動かす（項目と同じ手応え）。 */
  private onGridKey(event: KeyboardEvent): void {
    const shape = this.selectedGridShape();
    if (shape === undefined) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.pendingStatus = "罫線を消しました";
      this.send({ kind: "setGridKeyword", sourceLine: shape.recordLine, index: shape.index, keyword: "" });
      return;
    }
    const step = arrowStep(event.key);
    if (!step) return;
    event.preventDefault();
    this.writeGrid(shape, moveGrid(shape.geometry, step.row, step.column, this.canvasSize()));
  }

  /** 選んだ罫線のプロパティ。形・色・線種を変えられる（利用者の決定: 後からも変えられる）。 */
  private renderGridProperties(shape: GridShape): void {
    const table = document.createElement("table");
    table.className = "dds-props dds-grid-props";
    const row = (label: string, control: HTMLElement): void => {
      const tr = document.createElement("tr");
      const head = document.createElement("td");
      head.textContent = label;
      const cell = document.createElement("td");
      cell.appendChild(control);
      tr.append(head, cell);
      table.appendChild(tr);
    };
    const geometry = shape.geometry;
    row("罫線", text("span", "", `${geometry.kind === "box" ? "箱（GRDBOX）" : "線（GRDLIN）"}・様式 ${shape.recordName}`));
    row(
      "位置",
      text(
        "span",
        "",
        geometry.kind === "box"
          ? `${geometry.row} 行 ${geometry.column} 桁・${geometry.depth} 行 × ${geometry.width} 桁`
          : `${geometry.row} 行 ${geometry.column} 桁・長さ ${geometry.length}`
      )
    );

    const select = (key: string, options: ReadonlyArray<[string, string]>, value: string, onChange: (value: string) => void) => {
      const control = document.createElement("select");
      control.dataset.key = key;
      for (const [optionValue, label] of options) {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = label;
        option.selected = optionValue === value;
        control.appendChild(option);
      }
      control.addEventListener("change", () => onChange(control.value));
      return control;
    };

    if (geometry.kind === "box") {
      row(
        "形",
        select("grid:type", BOX_TYPES, geometry.type, value =>
          this.writeGrid(shape, { ...geometry, type: value as typeof geometry.type })
        )
      );
      const rule = (key: "horizontalRule" | "verticalRule", label: string): void => {
        const input = document.createElement("input");
        input.type = "number";
        input.min = "1";
        input.dataset.key = `grid:${key}`;
        input.value = String(geometry[key] ?? 1);
        input.addEventListener("change", () => {
          const value = Number(input.value);
          if (Number.isInteger(value) && value >= 1) this.writeGrid(shape, { ...geometry, [key]: value });
        });
        row(label, input);
      };
      if (geometry.type === "HRZ" || geometry.type === "HRZVRT") rule("horizontalRule", "横の罫線の間隔");
      if (geometry.type === "VRT" || geometry.type === "HRZVRT") rule("verticalRule", "縦の罫線の間隔");
    } else {
      row(
        "形",
        select("grid:type", LINE_TYPES, geometry.type, value =>
          this.writeGrid(shape, { ...geometry, type: value as typeof geometry.type })
        )
      );
    }
    row(
      "色",
      select("grid:color", [["", "指定しない"], ...GRID_COLORS], shape.writtenColor ?? "", value =>
        this.writeGrid(shape, geometry, { color: value ? (value as GridColor) : undefined })
      )
    );
    row(
      "線種",
      select("grid:lintype", [["", "指定しない"], ...GRID_LINE_TYPES], shape.writtenLineType ?? "", value =>
        this.writeGrid(shape, geometry, { lineType: value ? (value as GridLineType) : undefined })
      )
    );
    const note = text("div", "dds-note", "指定しない色・線種は GRDATR（無ければ白・実線）が効きます。Delete で消せます。");
    this.properties.replaceChildren(table, note);
  }

  private select(sourceLine: number | undefined): void {
    if (this.selected === sourceLine && this.selectedGrid === undefined) return;
    this.selected = sourceLine;
    this.selectedGrid = undefined;
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
   * 一覧の見出しの `＋`。**キーワードの `＋ 追加` と同じ約束**にそろえる
   * （`addKeywordButton`）——押すと隠してある入力欄が出て焦点が移り、
   * `Enter` で確定、`Escape` で閉じて `＋` へ焦点が戻る。
   *
   * **`blur` では確定しない。** 改名（`recordNameInput`）は「既にある値を直す」ので
   * 抜けたら確定が自然だが、追加は「無かったものを作る」——**焦点が外れただけで
   * 様式ができるのは驚き**になる。
   *
   * 入力欄が素の `<input>` なのは意図的で、`isTypingTarget` がこれを見て
   * **キーをキャンバスへ漏らさない**（漏らすと `Delete` で項目が消え、矢印で項目が動く）。
   */
  private wireAddRecord(): void {
    this.addRecord.addEventListener("click", () => {
      this.addRecordInput.hidden = false;
      this.addRecordInput.value = "";
      this.addRecordInput.focus();
    });

    this.addRecordInput.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeAddRecord();
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();

      const name = this.addRecordInput.value.trim();
      if (name.length === 0) return; // 空は送らない（`addKeywordButton` と同じ）。

      // 罫線を引いたが罫線の様式が無かった。聞いた名前で GRDRCD の様式を作って書く。
      if (this.pendingGridKeyword !== undefined) {
        const keyword = this.pendingGridKeyword;
        this.pendingRecordFocus = false;
        this.pendingStatus = `罫線の様式 ${name.toUpperCase()} を作り、罫線を引きました`;
        this.send({ kind: "addGrid", recordName: name, keyword, createRecord: true });
        return;
      }

      // 拒否されたら**入力欄を閉じない**（打った名前が消えると、何が悪かったのか分からない）。
      // 閉じるのは `applied` を受けたときだけ。
      this.pendingSelectRecord = name;
      this.pendingRecordFocus = true;
      this.pendingStatus = `様式 ${name.toUpperCase()} を作りました`;
      this.send({ kind: "addRecord", name });
    });
  }

  /**
   * 入力欄を閉じて `＋` へ焦点を戻す（`Escape`）。**送らない。**
   *
   * 焦点を動かすので、**開いていたときだけ**呼ぶ形にしてある——どの編集でも呼ぶと、
   * 項目を動かすたびに焦点が `＋` へ飛ぶ。
   */
  private closeAddRecord(): void {
    this.hideAddRecord();
    this.addRecord.focus();
  }

  /** 入力欄を畳むだけ。**焦点は動かさない**（適用後の行き先は別に決まっている）。 */
  private hideAddRecord(): void {
    this.addRecordInput.hidden = true;
    this.addRecordInput.value = "";
    this.addRecordInput.placeholder = "";
    this.pendingGridKeyword = undefined;
  }

  /**
   * 様式を消す。**確認しない**——この PJ は「即座に実行して undo で戻す」で統一してあり
   * （項目の削除も確認しない）、ここだけモーダルにすると作法が割れる。
   *
   * 代わりに**何が消えたかを後から知らせる**。件数は**送る前に**数える
   * （消えた後には数えられない）。
   */
  private removeRecord(record: RenderModel["outline"][number]): void {
    this.pendingStatus =
      `${record.name} を削除しました（項目 ${record.items.length} 件）`;
    // 焦点と選択の行き先は**隣の様式**（消えた行に残らない）。
    // 隣が無い＝最後の 1 つを消した。`null` を置いて「選択を外して `＋` へ」を伝える
    // ——`undefined` にすると `applied` の分岐ごと飛んで、焦点が body に落ちる。
    this.pendingSelectRecord = this.neighbourRecordName(record.name) ?? null;
    this.pendingRecordFocus = true;
    this.send({ kind: "removeRecord", sourceLine: record.sourceLine });
  }

  /** 一覧の並びで隣にある様式の名前（前があれば前、無ければ次。無ければ undefined）。 */
  private neighbourRecordName(name: string): string | undefined {
    const named = ((this.view ?? this.model)?.outline ?? []).filter(
      record => record.name.length > 0
    );
    const at = named.findIndex(record => record.name === name);
    if (at < 0) return undefined;
    return named[at - 1]?.name ?? named[at + 1]?.name;
  }

  /**
   * クリックした行に置くとしたら、どの様式か。
   *
   * **行から様式は厳密には決まらない**——画面ファイルの様式は行が重なりうる
   * （同じ画面に複数の様式を書き出す）。順に:
   *
   * 1. **様式の見出しを選んでいるなら、その様式**
   * 2. その行以上で**いちばん下にある項目**の様式（行の見当）
   * 3. 最後の様式
   *
   * ■ 見出しの選択を行の見当より優先する
   *   以前は「項目を 1 つも持たない様式」のときだけ選択を採り、項目のある様式では
   *   行の見当を優先していた（見出しは `OVERLAY` / `CF03` を読むためにも選ぶので、
   *   そのまま押した人は押した行の様式に入ると思っている、という考え）。
   *   しかし実操作で、ウィンドウ・足元・サブファイル制御のように**行が重なる様式**では
   *   選んだ様式へ置く方法が無く、**黙って別の様式に入った**（2026-09-27 の調査の D14。
   *   `FOOTER` を選んで 22 行目に置くとサブファイルへ、ウィンドウを選ぶと下の様式へ）。
   *   明示した選択より見当が勝つと、置き先を利用者が決められない。
   *   見当で決まる場合も含め、置いた様式は状況表示で必ず知らせる（`place`）。
   *
   * ■ 項目を選んでいるときは対象外
   *   見出しを選ぶのは「この様式で作業する」という明示だが、項目を選ぶのは
   *   その項目を見ているだけで、置き先の宣言ではない。
   */
  private recordAt(point: CellPoint): string | undefined {
    const heading = this.selectedRecordHeading();
    if (heading !== undefined) return heading;

    const model = this.view ?? this.model;
    // **ウィンドウの枠の中を押したなら、そのウィンドウの様式。** 後に定義したものほど上に出る。
    const inside = [...(model?.windows ?? [])]
      .reverse()
      .find(window =>
        point.row > window.top && point.row < window.bottom &&
        point.column > window.left && point.column < window.right
      );
    const items = (model?.items ?? []).filter(item =>
      inside === undefined ? item.origin === undefined : inside.records.includes(item.recordName ?? "")
    );
    const row = point.row;
    let best: RenderItem | undefined;
    for (const item of items) {
      if (item.recordName === undefined) continue;
      if (screenPoint(item).row > row) continue;
      if (!best || screenPoint(item).row > screenPoint(best).row || (screenPoint(item).row === screenPoint(best).row && item.sourceLine > best.sourceLine)) {
        best = item;
      }
    }
    if (best === undefined && inside !== undefined) return inside.recordName;
    const records = (this.view ?? this.model)?.records ?? [];
    return best?.recordName ?? records[records.length - 1];
  }

  /**
   * **様式の見出しそのもの**を選んでいるならその名前（項目を選んでいるなら undefined）。
   *
   * 名前の無い束（「（様式の外）」）は様式ではないので返さない。
   */
  private selectedRecordHeading(): string | undefined {
    const selected = this.selected;
    if (selected === undefined) return undefined;
    const record = ((this.view ?? this.model)?.outline ?? []).find(
      candidate => candidate.sourceLine === selected
    );
    return record !== undefined && record.name.length > 0 ? record.name : undefined;
  }

  /** 様式が表示されるウィンドウ（定義・参照・中のサブファイル）。 */
  private windowOfRecord(record: string): DspfWindow | undefined {
    return ((this.view ?? this.model)?.windows ?? []).find(window => window.records.includes(record));
  }

  /** 項目がウィンドウの中なら、描くときに足す量と動かせる範囲。 */
  private itemWindow(sourceLine: number): Pick<Gesture, "window"> {
    const item = ((this.view ?? this.model)?.items ?? []).find(candidate => candidate.sourceLine === sourceLine);
    const window = item?.recordName === undefined ? undefined : this.windowOfRecord(item.recordName);
    if (item?.origin === undefined || window === undefined) return {};
    const bounds = windowBounds(window);
    return { window: { origin: item.origin, bounds: { rows: Math.max(1, bounds.rows), columns: bounds.columns } } };
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
      // ウィンドウの中の項目は**ウィンドウの中だけ**を動く（位置欄はウィンドウの中の値）。
      gesture.window?.bounds ?? this.canvasSize()
    );
    return gesture.rowFromSpacing ? { ...target, row: gesture.origin.row } : target;
  }

  private resizeTarget(gesture: Gesture, deltaX: number): number {
    return resizedTo(
      gesture.widthCols,
      gesture.origin.column,
      deltaX,
      this.cellMetrics(),
      gesture.window?.bounds ?? this.canvasSize()
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

/**
 * 帳票の見え方の説明。**画面とは語彙が違う**——反転表示も明滅も非表示も無い。
 *
 * 色の和名は原典の表から引く（`printColorLabel`）。ここに写さない。
 */
function describePrintAppearance(print: PrintAppearance): string {
  const marks: string[] = [];
  if (print.bold) marks.push("太字");
  if (print.underline) marks.push("下線");
  const color = print.deviceColor
    ? "カラー指定あり（装置依存）"
    : (printColorLabel(print.color) ?? print.color);
  return ` / ${color}${marks.length > 0 ? `・${marks.join("・")}` : ""}`;
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

/** 色（原典 `GRDATR` の表 1）。 */
const GRID_COLORS: ReadonlyArray<[string, string]> = [
  ["BLU", "BLU 青"], ["GRN", "GRN 緑"], ["CYAN", "CYAN 空色"], ["RED", "RED 赤"], ["VLT", "VLT 紫"],
  ["YLW", "YLW 黄"], ["WHT", "WHT 白"], ["GRY", "GRY グレー"], ["LBLU", "LBLU 明るい青"], ["LGRN", "LGRN 明るい緑"],
  ["LTRQ", "LTRQ 明るい空色"], ["LRED", "LRED 明るい赤"], ["LVLT", "LVLT 明るい紫"], ["LYLW", "LYLW 明るい黄色"],
  ["HWHT", "HWHT 高輝度の白"], ["BLK", "BLK 黒"]
];
/** 線種（原典 `GRDATR` の表 2）。 */
const GRID_LINE_TYPES: ReadonlyArray<[string, string]> = [
  ["SLD", "SLD 実線"], ["THK", "THK 太線"], ["DBL", "DBL 二重線"], ["DOT", "DOT 点線"],
  ["DSH", "DSH 破線"], ["THKDSH", "THKDSH 太破線"], ["DBLDSH", "DBLDSH 二重破線"]
];
const BOX_TYPES: ReadonlyArray<[string, string]> = [
  ["PLAIN", "PLAIN 枠だけ"], ["HRZ", "HRZ 横の罫線"], ["VRT", "VRT 縦の罫線"], ["HRZVRT", "HRZVRT 横と縦の罫線"]
];
const LINE_TYPES: ReadonlyArray<[string, string]> = [
  ["UPPER", "UPPER 行の上"], ["LOWER", "LOWER 行の下"], ["LEFT", "LEFT 桁の左"], ["RIGHT", "RIGHT 桁の右"]
];

/** ツールバーの選択肢（先頭は「指定しない」）。 */
function gridOptions(label: string, options: ReadonlyArray<[string, string]>): string {
  return [`<option value="">${label}: 指定しない</option>`, ...options.map(([value, text]) => `<option value="${value}">${text}</option>`)].join("");
}

/** 罫線の形の右下（箱）／終わり（線）の境目。つまみを置く所。 */
function gridEnd(geometry: GridGeometry): { row: number; column: number } {
  if (geometry.kind === "box") return { row: geometry.row - 1 + geometry.depth, column: geometry.column - 1 + geometry.width };
  switch (geometry.type) {
    case "UPPER": return { row: geometry.row - 1, column: geometry.column - 1 + geometry.length };
    case "LOWER": return { row: geometry.row, column: geometry.column - 1 + geometry.length };
    case "LEFT": return { row: geometry.row - 1 + geometry.length, column: geometry.column - 1 };
    case "RIGHT": return { row: geometry.row - 1 + geometry.length, column: geometry.column };
  }
}

/** 形を動かす（画面の外へは出さない）。 */
function moveGrid(geometry: GridGeometry, rows: number, columns: number, canvas: CanvasSize): GridGeometry {
  const span = geometry.kind === "box"
    ? { rows: geometry.depth, columns: geometry.width }
    : geometry.type === "UPPER" || geometry.type === "LOWER"
      ? { rows: 1, columns: geometry.length }
      : { rows: geometry.length, columns: 1 };
  return {
    ...geometry,
    row: clamp(geometry.row + rows, 1, Math.max(1, canvas.rows - span.rows + 1)),
    column: clamp(geometry.column + columns, 1, Math.max(1, canvas.columns - span.columns + 1))
  };
}

/** つまみで大きさを変える。箱は深さと幅、横線は長さ（桁）、縦線は長さ（行）。1 未満にはしない。 */
function resizeGrid(geometry: GridGeometry, rows: number, columns: number, canvas: CanvasSize): GridGeometry {
  if (geometry.kind === "box") {
    return {
      ...geometry,
      depth: clamp(geometry.depth + rows, 1, canvas.rows - geometry.row + 1),
      width: clamp(geometry.width + columns, 1, canvas.columns - geometry.column + 1)
    };
  }
  const horizontal = geometry.type === "UPPER" || geometry.type === "LOWER";
  return {
    ...geometry,
    length: horizontal
      ? clamp(geometry.length + columns, 1, canvas.columns - geometry.column + 1)
      : clamp(geometry.length + rows, 1, canvas.rows - geometry.row + 1)
  };
}

/** 引いている途中・動かしている途中の枠。箱は 4 辺、線はその線の位置に細い帯で描く。 */
function placeGridDraft(element: HTMLElement, geometry: GridGeometry): void {
  const end = gridEnd(geometry);
  // 箱は左上から右下まで。線は線そのものの位置（太さ 0 の帯。枠線で見せる）。
  const horizontal = geometry.kind === "line" && (geometry.type === "UPPER" || geometry.type === "LOWER");
  const vertical = geometry.kind === "line" && !horizontal;
  const top = horizontal ? end.row : geometry.row - 1;
  const left = vertical ? end.column : geometry.column - 1;
  element.style.left = `calc(var(--cell-w) * ${left})`;
  element.style.top = `calc(var(--cell-h) * ${top})`;
  element.style.width = `calc(var(--cell-w) * ${end.column - left})`;
  element.style.height = `calc(var(--cell-h) * ${end.row - top})`;
}

/** 画面に描く位置。ウィンドウの中の項目は枠の位置を足す（原典「上枠行 + 行」「左枠桁 + 桁 + 1」）。 */
function screenPoint(item: Pick<RenderItem, "row" | "column" | "origin">): CellPoint {
  return {
    row: item.row + (item.origin?.row ?? 0),
    column: item.column + (item.origin?.column ?? 0)
  };
}

/** 画面の位置をウィンドウの中の位置に直す。枠の外なら枠の中の端に寄せる。 */
function toWindowPoint(window: DspfWindow, screen: CellPoint): CellPoint {
  const origin = windowOrigin(window);
  const bounds = windowBounds(window);
  return {
    row: clamp(screen.row - origin.row, 1, Math.max(1, bounds.rows)),
    column: clamp(screen.column - origin.column, 1, Math.max(1, bounds.columns))
  };
}

/**
 * ウィンドウの枠（`WINDOW`）。描くだけで掴めない。
 *
 * 枠は原典の式どおり上枠行〜下枠行・左枠桁〜右枠桁を占める。最終行がメッセージ行なら薄く示す。
 * 開始位置が実行時に決まる（`*DFT` / `&フィールド`）ものは、画面の左上に仮に置いたことを見出しで言う。
 */
function windowFrame(window: DspfWindow): HTMLElement {
  const frame = document.createElement("div");
  frame.className = window.startKnown ? "dds-window" : "dds-window floating";
  frame.dataset.record = window.recordName;
  frame.style.left = `calc(var(--cell-w) * ${window.left - 1})`;
  frame.style.top = `calc(var(--cell-h) * ${window.top - 1})`;
  frame.style.width = `calc(var(--cell-w) * ${window.right - window.left + 1})`;
  frame.style.height = `calc(var(--cell-h) * ${window.bottom - window.top + 1})`;
  const where = window.startKnown
    ? `${window.top} 行 ${window.left} 桁`
    : "開始位置は実行時に決まる（仮に左上に描いています）";
  frame.title = `ウィンドウ ${window.recordName}（${where} / ${window.lines} 行 × ${window.positions} 桁）`;
  const label = document.createElement("span");
  label.className = "dds-window-label";
  label.textContent = window.startKnown ? window.recordName : `${window.recordName}（位置は実行時）`;
  frame.appendChild(label);
  if (window.messageLine) {
    const message = document.createElement("div");
    message.className = "dds-window-message";
    message.style.top = `calc(var(--cell-h) * ${window.lines})`;
    message.title = "メッセージ行（項目は置けません）";
    frame.appendChild(message);
  }
  return frame;
}

/**
 * 罫線 1 本（`GRDBOX` / `GRDLIN`）。**文字の枠の上**に引く（桁・行の境目）。描くだけで掴めない。
 * 色と線種は原典 `GRDATR` の値をそのまま class にし、見え方は CSS が決める。
 */
function gridLine(line: GridLine): HTMLElement {
  const element = document.createElement("div");
  element.className = `dds-grid ${line.orientation} g-${line.color.toLowerCase()} l-${line.lineType.toLowerCase()}`;
  // `data-source-line` は付けない（項目を掴むときにその属性で探しているため）。
  element.dataset.gridLine = String(line.sourceLine);
  if (line.orientation === "horizontal") {
    element.style.top = `calc(var(--cell-h) * ${line.at})`;
    element.style.left = `calc(var(--cell-w) * ${line.from})`;
    element.style.width = `calc(var(--cell-w) * ${line.to - line.from})`;
  } else {
    element.style.left = `calc(var(--cell-w) * ${line.at})`;
    element.style.top = `calc(var(--cell-h) * ${line.from})`;
    element.style.height = `calc(var(--cell-h) * ${line.to - line.from})`;
  }
  element.title = `罫線（様式 ${line.recordName}・ソース ${line.sourceLine} 行目・${line.color} ${line.lineType}）`;
  return element;
}

/**
 * サブファイルを 1 ページ（`SFLPAG`）ぶん描く。**2 件目以降は写しで、掴めない**
 * （ソースの項目は 1 つ。どれを動かしても同じ行が書き換わるので、元の 1 件だけを掴ませる）。
 */
function subfileRepeats(item: RenderItem, element: HTMLElement): HTMLElement[] {
  const repeat = item.repeat;
  if (repeat === undefined) return [];
  const copies: HTMLElement[] = [];
  const top = screenPoint(item).row;
  for (let index = 1; index < repeat.count; index += 1) {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.classList.add("sfl-repeat");
    copy.classList.remove("selected");
    copy.querySelector(".handle")?.remove();
    delete copy.dataset.sourceLine;
    copy.removeAttribute("title");
    copy.style.top = `calc(var(--cell-h) * ${top + index * repeat.rowStep - 1})`;
    copies.push(copy);
  }
  return copies;
}

/** 属性文字の占有を薄く示す（隣接違反が起きる前に見えるように）。 */
function attributeMarkers(item: RenderItem, dimmed = false): HTMLElement[] {
  const markers: HTMLElement[] = [];
  const offset = { row: item.origin?.row ?? 0, column: item.origin?.column ?? 0 };
  for (const column of [item.occupancy.start, item.occupancy.end]) {
    if (column < 1) continue;
    const marker = document.createElement("div");
    marker.className = dimmed ? "dds-attr dimmed" : "dds-attr";
    marker.style.left = `calc(var(--cell-w) * ${column + offset.column - 1})`;
    marker.style.top = `calc(var(--cell-h) * ${item.row + offset.row - 1})`;
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
    <button id="dds-add-grid" type="button" title="キャンバスをドラッグした範囲に罫線を引きます（縦横とも 2 以上なら箱、1 行なら横線、1 桁なら縦線）">罫線を引く</button>
    <select id="dds-grid-color" title="引く罫線の色（*COLOR）。指定しないなら GRDATR・既定の白">${gridOptions("色", GRID_COLORS)}</select>
    <select id="dds-grid-lintype" title="引く罫線の線種（*LINTYP）。指定しないなら GRDATR・既定の実線">${gridOptions("線種", GRID_LINE_TYPES)}</select>
    <span class="sep"></span>
    <button id="dds-toggle-shifts" type="button" title="DBCS の前後にある SO / SI を { } で表示します（桁は元から空いています）">SO/SI</button>
    <button id="dds-toggle-attributes" type="button" title="項目の前後 1 桁を占める属性文字を示します">属性バイト</button>
    <button id="dds-toggle-grid" type="button" title="桁のグリッドを表示します">グリッド</button>
    <button id="dds-toggle-dim" type="button" title="選択中の項目が属する様式以外を淡く表示します">他様式を淡く</button>
    <button id="dds-toggle-colors" type="button" title="実機の見え方で描きます（画面: COLOR / DSPATR から色・反転表示・下線・非表示 / 帳票: HIGHLIGHT / UNDERLINE / COLOR から太字・下線・カラー）">見え方</button>
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
      <div class="pane-head">
        <div class="pane-title">レコード様式</div>
        <span class="rec-add">
          <button id="dds-add-record" type="button" title="レコード様式を足す（ファイルの末尾に付きます）">＋</button>
          <input id="dds-add-record-input" class="rec-add-input" maxlength="10" placeholder="様式名" hidden>
        </span>
        <button id="dds-fold-left" class="pane-fold" type="button" title="左を畳む（キャンバスに 200 桁ぶんの幅を返します）">◧</button>
      </div>
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
      <div class="pane-head">
        <button id="dds-fold-right" class="pane-fold" type="button" title="右を畳む（キャンバスに 320 桁ぶんの幅を返します）">◨</button>
        <div class="pane-title">プロパティ</div>
      </div>
      <div class="dds-properties"></div>
    </div>
  </div>
  <div class="dds-grip" title="ドラッグで高さを変えます／ダブルクリックで畳みます"></div>
  <div class="dds-dock">
    <div class="dds-dock-bar">
      <button class="tab" id="dds-tab-source" type="button" aria-selected="true">ソース</button>
      <button class="tab" id="dds-tab-diagnostics" type="button" aria-selected="false">検証<span class="badge"></span></button>
      <span class="spacer"></span>
      <button class="icon" id="dds-dock-half" type="button" title="半分">▤</button>
      <button class="icon" id="dds-dock-max" type="button" title="最大化">▣</button>
      <button class="icon" id="dds-dock-fold" type="button" title="畳む">▾</button>
    </div>
    <div class="dds-dock-body">
      <div class="dds-source"></div>
      <div class="dds-diagnostics" hidden></div>
    </div>
  </div>
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
