import {
  collectIndicators,
  conditionGroups,
  evaluateConditioning,
  type IndicatorStates,
  type IndicatorUsage
} from "./ddsConditioning";
import { resolveAppearanceUnder } from "./dspfAttributes";
import {
  fileLevelKeywordLines,
  type FileKeywordLine
} from "./ddsLogicalUnits";
import { readConditioning, type Conditioning } from "./ddsConditioning";
import {
  constantSegments,
  printWidth,
  segmentsWidth,
  toRenderItem,
  type RenderItem,
  type RenderSegment
} from "./ddsRenderItem";
import {
  occupanciesOverlap,
  resolveDspfLayout,
  type DspfDiagnostic,
  type DspfDiagnosticCode,
  type DspfLayout
} from "./dspfLayout";
import { resolveScreenSizes } from "./dspfScreenSize";
import type { PrintDensity } from "./prtfDensity";
import type { LayoutDiagnosticCode } from "./prtfLayout";
import {
  buildDspfOutline,
  type OutlineItem,
  type OutlineRecord
} from "./dspfOutline";

// **翻訳は種別に依らない**ので `ddsRenderItem` に置いてある。
// 既存の import 元を壊さないよう、ここからも出す。
export {
  constantSegments,
  printWidth,
  segmentsWidth,
  toRenderItem,
  type RenderItem,
  type RenderSegment
};

/**
 * 画面（DSPF）を**描くための形**。GUI に渡す唯一のモデル。
 *
 * **vscode を import しない。** VSCode の WebView でも、ブラウザ単体でも同じものを描けるようにする
 * ——この層が `vscode` に触った時点で、エディタは VSCode の外に出られなくなる。
 *
 * ## 判定はここに持たない
 *
 * 配置・幅・重なり・はみ出しは `resolveDspfLayout` が決める。ここがやるのは
 * **「描くのに必要な形へ翻訳する」**ことだけ——具体的には
 * 「文字と、それが何桁を占めるか」の対応（`segments`）を足す。
 *
 * ## なぜ `segments` が要るか
 *
 * DBCS は SO/SI が桁を消費するので、**リテラルをそのまま開始桁に置くと 1 桁ずれる**
 * （`'社員番号'` は SO+8+SI = 10 桁で、最初の文字は開始桁の**次**に出る）。
 * かといって UI 側で「これは全角か」を判定させると、桁の真実源が 2 つになる。
 * そこで**文字と占有桁数の対応を core が決めて渡し**、UI は `cols × セル幅` の箱に流すだけにする。
 */

/**
 * 描画モデルが載せる診断のコード。
 *
 * 画面（`resolveDspfLayout`）と帳票（`resolvePrtfLayout`）で**集合が違う**
 * （帳票には `spacing-with-line-number` / `possible-overprint` がある）。
 * **どちらも作り直さず、解決側が出したものをそのまま載せる**ので、和で持つ。
 */
export type RenderDiagnosticCode = DspfDiagnosticCode | LayoutDiagnosticCode;

export interface RenderDiagnostic {
  readonly code: RenderDiagnosticCode;
  readonly message: string;
  /** 1 始まり。 */
  readonly sourceLine: number;
}

/**
 * ファイル・レベルのキーワード（`DSPSIZ` / `REF` / `INDARA` / `PRINT` など）。
 *
 * **最初の様式より前**に書かれるので `toLogicalUnits` は論理単位にしない
 * （置けるものではないため）。一覧にもプロパティにも出ず、デザイナからは
 * **一切読めなかった**——`CUSTMNT.dspf` ではキーワード行 8 本のうち 4 本がこれにあたる。
 */
export interface FileKeywordEntry {
  /** 1 始まり。 */
  readonly sourceLine: number;
  readonly keywords: string;
  /** ファイル・レベルでも条件は書ける。 */
  readonly condition: Conditioning;
}

export interface RenderModel {
  /** 種別。DSPF のみ。PRTF を載せるときにここで分岐する。 */
  readonly kind: "dspf" | "prtf";
  readonly canvas: { readonly rows: number; readonly columns: number };
  /**
   * オーバーフロー行（帳票のみ）。ここを越えると次のページに送られる。
   *
   * 紙面の大きさと同じく **DDS には書かれていない**（`CRTPRTF` の `OVRFLW`）ので、
   * ホストが設定から渡す。画面ファイルには無い概念なので `undefined`。
   */
  readonly overflowLine?: number;
  /**
   * ページ数（帳票のみ）。**後戻りするスキップで増える。**
   *
   * 原典（`LPI`）: 「ある行番号へのスキップを指定した場合に、それが**現在位置より
   * 前の位置**であれば…**改ページが生じます**」。
   */
  readonly pages?: number;
  /** いま描いているページ（帳票のみ・1 始まり）。 */
  readonly currentPage?: number;
  /**
   * 印刷密度（帳票のみ）。**紙の比率で描く**ときに使う。
   *
   * ソースに `CPI` / `LPI` があればそれ、無ければ `CRTPRTF` の既定。
   * 画面ファイルには無い概念なので `undefined`。
   */
  readonly density?: PrintDensity;
  /** 描く項目（配置できたものだけ）。 */
  readonly items: readonly RenderItem[];
  readonly diagnostics: readonly RenderDiagnostic[];
  /** 様式の一覧（追加先の選択に使う）。 */
  readonly records: readonly string[];
  /**
   * **全項目**の一覧（様式ごと・配置に依らない）。
   *
   * `items` は画面に置けたものだけなので、位置欄が空・画面に出ない用途の項目は入らない。
   * それらにも手が届くように、一覧は別に持つ（`dspfOutline`）。鍵は `sourceLine` で共通。
   */
  readonly outline: readonly OutlineRecord[];
  /**
   * ソース中で使われている条件標識（番号順）。
   *
   * **キーワードだけを条件付ける標識も含む**（`collectIndicators` が生の行から集める）。
   * 項目の表示に効かない標識でも、一覧から抜けていると
   * 「この画面で意味を持つ標識」を数え上げる手段が無くなる。
   */
  readonly indicators: readonly IndicatorUsage[];
  /**
   * ファイル・レベルのキーワード（最初の様式より前）。
   *
   * `outline` は様式ごとの一覧なので、様式に属さないこれらはそこに入らない。
   * **別に持って渡す**（捨てると、デザイナからは読む手段が無い）。
   */
  readonly fileKeywords: readonly FileKeywordEntry[];
  /**
   * **2 次画面サイズでの絵**（`DSPSIZ` が 2 つのサイズを宣言しているときだけ）。
   *
   * 原典（`DSPSIZ` の 例 2 / 例 3）より、同じ項目をサイズごとに別の位置へ置ける
   * （「位置の上書き行」）。1 次だけを描いていると、**2 次画面での見え方が一切見えない**。
   *
   * 項目は同じ `sourceLine` を持つ（別の項目ではなく、同じ項目の別の位置）。
   */
  readonly secondaryScreen?: SecondaryScreen;
}

/** 2 次画面サイズでの解決結果。 */
export interface SecondaryScreen {
  readonly canvas: { readonly rows: number; readonly columns: number };
  /** 画面サイズ条件名（`*DS4` / ユーザー定義名）。数値形式の `DSPSIZ` では無い。 */
  readonly name?: string;
  readonly items: readonly RenderItem[];
  readonly diagnostics: readonly RenderDiagnostic[];
}

/** 生の行からファイル・レベルのキーワードを読み、条件を解く。 */
export function toFileKeywords(lines: readonly string[]): FileKeywordEntry[] {
  return fileLevelKeywordLines(lines).map((entry: FileKeywordLine) => ({
    sourceLine: entry.sourceLine,
    keywords: entry.keywords,
    condition: readConditioning(entry.conditioningLines)
  }));
}

/** ソース行から描画モデルを作る。 */
export function buildDspfRenderModel(lines: readonly string[]): RenderModel {
  const model: RenderModel = {
    ...fromLayout(resolveDspfLayout(lines), buildDspfOutline(lines), collectIndicators(lines)),
    fileKeywords: toFileKeywords(lines)
  };

  // 2 次画面サイズが宣言されていれば、そちらの絵も作る。
  const { sizes } = resolveScreenSizes(lines);
  if (sizes.secondary === undefined) return model;

  const secondary = resolveDspfLayout(lines, { screenSize: "secondary" });
  return {
    ...model,
    secondaryScreen: {
      canvas: { rows: secondary.screen.rows, columns: secondary.screen.columns },
      ...(sizes.secondary.conditionName !== undefined
        ? { name: sizes.secondary.conditionName }
        : {}),
      items: secondary.items.map(item => toRenderItem(item)),
      diagnostics: secondary.diagnostics
    }
  };
}

/** 既に解決済みのレイアウトから作る（二重に解決しないため）。 */
export function fromLayout(
  layout: DspfLayout,
  outline: readonly OutlineRecord[] = [],
  indicators: readonly IndicatorUsage[] = []
): RenderModel {
  const items = layout.items.map(item => toRenderItem(item));
  const records: string[] = [];
  for (const item of layout.items) {
    if (item.recordName && !records.includes(item.recordName)) {
      records.push(item.recordName);
    }
  }

  return {
    kind: "dspf",
    canvas: { rows: layout.screen.rows, columns: layout.screen.columns },
    items,
    diagnostics: layout.diagnostics,
    records,
    outline,
    indicators,
    // 生の行を持たないので空。`buildDspfRenderModel` が足す。
    fileKeywords: []
  };
}

/**
 * 標識の状態を描画モデルに反映する。**純関数**（引数を書き換えない）。
 *
 * ■ 状態が空なら引数をそのまま返す
 *   何も指定していないときの見え方を**構造で**固定する。ここで新しいモデルを組み直すと、
 *   「指定していないのに何かが変わった」を後から検査で追いかけ続けることになる。
 *
 * ■ 消すのは「不成立と決まった」項目だけ
 *   未設定の標識を含む条件は `unknown` で、**描く**。片方の標識だけ倒したときに
 *   無関係な項目まで消えると、標識を 1 つずつ確かめる使い方ができない。
 *
 * ■ 消した項目は一覧に残す
 *   キャンバスから消えた項目に一覧からも手が届かないと、戻す手段がテキストエディタしかなくなる。
 *   `outline` の同じ項目へ `condition-off` を付けて、理由が読める形で残す。
 *
 * ■ **見え方も作り直す**
 *   原典は条件が付く対象を「フィールド**または**キーワード」としており、
 *   `30 DSPATR(RI)` のように**キーワードだけが条件つき**の形がある。項目は出たままで
 *   反転表示だけ消える、が起きるので、残す項目の `appearance` も解き直す。
 *   条件つきの群を持たない項目は解き直しても同じ結果になるので、**元の項目をそのまま使う**
 *   （無駄な作り直しで参照が変わらないように）。
 */
export function applyIndicators(model: RenderModel, states: IndicatorStates): RenderModel {
  if (Object.keys(states).length === 0) return model;

  const hidden = new Set<number>();
  const shown: RenderItem[] = [];
  for (const item of model.items) {
    const result = evaluateConditioning(item.condition, states);
    if (result === "hidden") {
      hidden.add(item.sourceLine);
      continue;
    }
    shown.push(withAppearanceUnder(item, states));
  }

  return {
    ...model,
    items: shown,
    outline: hidden.size === 0 ? model.outline : markHidden(model.outline, hidden),
    diagnostics: [...model.diagnostics, ...overlapsUnderIndicators(shown, states)]
  };
}

/**
 * キーワードの条件を解いて見え方を作り直す。**条件つきの群が無ければ元のまま返す。**
 *
 * 元のまま返すのは速さのためではなく、**参照が変わらないこと**に意味があるため
 * ——変わらないはずのものが変わると、後から「なぜ変わったか」を追う羽目になる。
 */
function withAppearanceUnder(item: RenderItem, states: IndicatorStates): RenderItem {
  const conditional = item.keywordGroups.some(group => group.conditioning.kind !== "none");
  if (!conditional) return item;
  return { ...item, appearance: resolveAppearanceUnder(item.keywordGroups, states) };
}

/** 一覧に「条件で非表示」を付ける。**構造的な理由が既にある項目は触らない。** */
function markHidden(
  outline: readonly OutlineRecord[],
  hidden: ReadonlySet<number>
): OutlineRecord[] {
  return outline.map((record) => ({
    ...record,
    items: record.items.map((item): OutlineItem =>
      item.hidden === undefined && hidden.has(item.sourceLine)
        ? { ...item, hidden: "condition-off" }
        : item
    )
  }));
}

/**
 * その標識の状態で**同時に表示されると決まった**項目どうしの重なり。
 *
 * ■ なぜ既存の重なり検出と別に持つか
 *   `resolveDspfLayout` の検出は `isMutuallyExclusive` が「片方でも条件が付いていれば排他」と
 *   保守的に倒しているので、**条件付きの重なりを報告しない**。原典が
 *   「相互にオーバーラップするフィールドのうち、一時点で画面に表示されるのは 1 つだけ」と
 *   認めている以上、静的に厳密化すると `01` と `02` の重なりまで報告することになる
 *   （同時にオンになりうるので、静的には排他でない）。
 *
 *   利用者が**標識の組み合わせを言い切った**ときだけなら、その前提が置けるので誤検出にならない。
 *
 * ■ `unknown` は対象にしない
 *   出るとは決まっていない項目を重なりの相手にすると、指定していない標識のせいで
 *   指摘が出ることになる。
 */
function overlapsUnderIndicators(
  items: readonly RenderItem[],
  states: IndicatorStates
): DspfDiagnostic[] {
  const definite = items.filter(
    (item) => evaluateConditioning(item.condition, states) === "shown"
  );
  const diagnostics: DspfDiagnostic[] = [];

  for (let i = 0; i < definite.length; i += 1) {
    for (let j = i + 1; j < definite.length; j += 1) {
      const a = definite[i];
      const b = definite[j];
      if (a.row !== b.row) continue;
      if (a.recordName !== b.recordName) continue;
      if (a.widthCols === undefined || b.widthCols === undefined) continue;
      // 両方とも無条件の組は `resolveDspfLayout` が既に報告している。二重に出さない。
      if (a.condition.kind === "none" && b.condition.kind === "none") continue;
      if (!occupanciesOverlap(a.occupancy, b.occupancy)) continue;

      diagnostics.push({
        code: "overlap-under-indicators",
        message:
          `標識 ${describeStatesFor([a, b], states)} のとき ` +
          `${describeItem(a)} と ${describeItem(b)} が ` +
          `${a.row} 行目で重なります（属性文字を含む占有で判定）`,
        sourceLine: b.sourceLine
      });
    }
  }

  return diagnostics;
}

/**
 * 指摘に添える標識の状態。**その 2 つの項目が使っている標識だけ**を出す。
 *
 * 設定中の標識をすべて並べると、この重なりに関係の無い標識まで載る
 * （「01=オン, 02=オン, 50=オフ のとき FLD1 と FLD2 が重なります」の `50` は無関係）。
 * 何を戻せば消える指摘なのかが読めなくなる。
 */
function describeStatesFor(items: readonly RenderItem[], states: IndicatorStates): string {
  const used = new Set<string>();
  for (const item of items) {
    for (const group of conditionGroups(item.condition)) {
      for (const term of group) used.add(term.indicator);
    }
  }

  return [...used]
    .filter((indicator) => states[indicator] !== undefined)
    .sort((a, b) => a.localeCompare(b))
    .map((indicator) => `${indicator}=${states[indicator] === "on" ? "オン" : "オフ"}`)
    .join(", ");
}

function describeItem(item: RenderItem): string {
  return item.kind === "constant" ? `定数 '${item.label}'` : (item.label || "名前のない項目");
}

