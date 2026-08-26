import { isDbcsCodePoint, printWidth } from "../dbcs";
import {
  collectIndicators,
  conditionGroups,
  describeConditioning,
  evaluateConditioning,
  type Conditioning,
  type IndicatorStates,
  type IndicatorUsage
} from "./ddsConditioning";
import {
  occupanciesOverlap,
  resolveDspfLayout,
  type DspfDiagnostic,
  type DspfLayout
} from "./dspfLayout";
import {
  buildDspfOutline,
  type ItemAttributes,
  type OutlineItem,
  type OutlineRecord
} from "./dspfOutline";

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

/** 描画の 1 区切り。SO/SI は `text` が空の 1 桁として現れる。 */
export interface RenderSegment {
  readonly text: string;
  readonly cols: number;
  /**
   * SO / SI の桁。
   *
   * **表示切替で `{` `}` を描くために持つ。** UI に「これは全角か」を判断させないため、
   * 種別は区切りを作るときに決める（桁の判断は core、描くのは UI）。
   */
  readonly shift?: "so" | "si";
}

export interface RenderItem {
  /** 1 始まり。**編集の宛先**（合成 ID は持たない——構造が変わると別の項目を指すため）。 */
  readonly sourceLine: number;
  readonly kind: "field" | "constant";
  /** 1 始まり。 */
  readonly row: number;
  /** 1 始まり・表示桁。 */
  readonly column: number;
  /** 表示桁数（DBCS・SO/SI 込み）。幅不明なら undefined。 */
  readonly widthCols: number | undefined;
  /** 表示するラベル（定数はリテラル、フィールドは名前）。 */
  readonly label: string;
  /** 描画の区切り。`cols` の合計は `widthCols`。幅不明なら空。 */
  readonly segments: readonly RenderSegment[];
  /** 属性文字を含む実効占有（1 始まり・両端を含む）。 */
  readonly occupancy: { readonly start: number; readonly end: number };
  /** 長さ欄を持つか。**定数は持たない**ので、長さは変えられない。 */
  readonly resizable: boolean;
  readonly recordName?: string;
  /** プロパティに出す値。**キーワードは解釈しない**（生テキスト）。 */
  readonly attributes: ItemAttributes;
  /**
   * 条件付け（7-16 桁）。**ここでは解決しない。**
   *
   * どの標識が立っているかは**利用者が指定する表示の状態**で、ソースには書かれていない。
   * モデルに解決済みの真偽を載せると、状態が変わるたびにホストへ作り直しを頼むことになる。
   * 規則（`evaluateConditioning`）は core に置いたまま、状態は UI が持つ。
   */
  readonly condition: Conditioning;
}

export interface RenderModel {
  /** 種別。DSPF のみ。PRTF を載せるときにここで分岐する。 */
  readonly kind: "dspf";
  readonly canvas: { readonly rows: number; readonly columns: number };
  /** 描く項目（配置できたものだけ）。 */
  readonly items: readonly RenderItem[];
  readonly diagnostics: readonly DspfDiagnostic[];
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
}

/** ソース行から描画モデルを作る。 */
export function buildDspfRenderModel(lines: readonly string[]): RenderModel {
  return fromLayout(resolveDspfLayout(lines), buildDspfOutline(lines), collectIndicators(lines));
}

/** 既に解決済みのレイアウトから作る（二重に解決しないため）。 */
export function fromLayout(
  layout: DspfLayout,
  outline: readonly OutlineRecord[] = [],
  indicators: readonly IndicatorUsage[] = []
): RenderModel {
  const items = layout.items.map(toRenderItem);
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
    indicators
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
    shown.push(item);
  }

  return {
    ...model,
    items: shown,
    outline: hidden.size === 0 ? model.outline : markHidden(model.outline, hidden),
    diagnostics: [...model.diagnostics, ...overlapsUnderIndicators(shown, states)]
  };
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

function toRenderItem(item: DspfLayout["items"][number]): RenderItem {
  const label = item.kind === "constant" ? (item.text ?? "") : (item.name ?? "");
  const condition = describeConditioning(item.conditioning);

  return {
    sourceLine: item.sourceLine,
    kind: item.kind,
    row: item.row,
    column: item.column,
    widthCols: item.width,
    label,
    segments:
      item.width === undefined
        ? []
        : item.kind === "constant"
          ? constantSegments(item.text ?? "")
          : [{ text: placeholder(item), cols: item.width }],
    occupancy: item.occupancy,
    // 定数は桁数欄を持たない（原典: 固定情報フィールドに桁数を指定してはならない）。
    resizable: item.kind === "field" && item.width !== undefined,
    attributes: {
      ...(item.name !== undefined ? { name: item.name } : {}),
      ...(item.text !== undefined ? { text: item.text } : {}),
      ...(item.width !== undefined && item.kind === "field" ? { length: item.width } : {}),
      ...(item.dataType !== undefined ? { dataType: item.dataType } : {}),
      ...(item.decimals !== undefined ? { decimals: item.decimals } : {}),
      ...(item.usage !== undefined ? { usage: item.usage } : {}),
      keywords: item.keywords,
      ...(condition.length > 0 ? { condition } : {})
    },
    condition: item.conditioning,
    ...(item.recordName !== undefined ? { recordName: item.recordName } : {})
  };
}

/**
 * フィールドの見え方。SDA と同じ流儀で、長さと位置が分かる形にする。
 *
 * 実際に何が出るかは実行時のデータ次第なので、**名前ではなくプレースホルダ**を敷く
 * （名前を出すと、名前の長さと桁数が食い違って見える）。
 */
function placeholder(item: DspfLayout["items"][number]): string {
  const numeric = (item.name ?? "").length > 0 && isNumericLike(item);
  return (numeric ? "9" : "X").repeat(item.width ?? 0);
}

function isNumericLike(item: DspfLayout["items"][number]): boolean {
  return item.kind === "field" && /^[SY]$/u.test((item.dataType ?? "").trim().toUpperCase());
}

/**
 * 定数の区切り。**`printWidth` と同じ規則**で歩く（SO/SI が桁を消費する）。
 *
 * 同じ種別の連なりは 1 区切りにまとめる。全角の連なりは `cols` が文字数の 2 倍、
 * SO / SI は**空文字の 1 桁**として現れる。
 */
export function constantSegments(text: string): RenderSegment[] {
  const segments: RenderSegment[] = [];
  let run = "";
  let runCols = 0;
  let inDbcsRun = false;

  const flush = (): void => {
    if (runCols > 0) {
      segments.push({ text: run, cols: runCols });
      run = "";
      runCols = 0;
    }
  };
  const shift = (kind: "so" | "si"): void => {
    flush();
    segments.push({ text: "", cols: 1, shift: kind });
  };

  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    const dbcs = isDbcsCodePoint(codePoint);

    if (dbcs && !inDbcsRun) {
      shift("so");
      inDbcsRun = true;
    } else if (!dbcs && inDbcsRun) {
      shift("si");
      inDbcsRun = false;
    }

    run += character;
    runCols += dbcs ? 2 : 1;
  }

  if (inDbcsRun) {
    shift("si"); // 行末まで DBCS が続いた場合のシフトイン
  }
  flush();

  return segments;
}

/** 区切りの合計と `printWidth` が一致することの保証（テストが使う）。 */
export function segmentsWidth(segments: readonly RenderSegment[]): number {
  return segments.reduce((total, segment) => total + segment.cols, 0);
}

export { printWidth };
