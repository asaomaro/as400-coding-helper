import { isDbcsCodePoint, printWidth } from "../dbcs";
import {
  describeConditioning,
  type Conditioning,
  type KeywordGroup
} from "./ddsConditioning";
import {
  DEFAULT_APPEARANCE,
  resolveAppearanceUnder,
  type ScreenAppearance
} from "./dspfAttributes";
import { resolvePrintAppearance, type PrintAppearance } from "./prtfAppearance";
import type { ItemAttributes } from "./dspfOutline";

/**
 * **描くための項目の形**と、配置解決の結果からそこへの翻訳。
 *
 * DSPF と PRTF で**同じ形**を使う。描画に要るのは「文字と、それが何桁を占めるか」で、
 * これは画面か紙かに依らない。配置（どこに置くか）は種別ごとの解決
 * （`resolveDspfLayout` / `resolvePrtfLayout`）が決め、ここはその結果を翻訳するだけ。
 *
 * **vscode を import しない。**
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
   * 行が**行送り**（`SPACE` / `SKIP`）で決まる（PRTF）。
   *
   * true のとき UI は**縦のドラッグを止める**——行番号を書き込むと
   * `SPACE` / `SKIP` が無効になり、別のものになるため。
   */
  readonly rowFromSpacing?: boolean;
  /**
   * 実機での見え方（色・反転表示・下線・明滅・非表示）。
   *
   * `COLOR` / `DSPATR` から求める。対応表は原典から生成し、**実機の画面と全 61 通りを
   * 突き合わせて確認済み**（`20260827-dds-5250-colors`）。
   */
  readonly appearance: ScreenAppearance;
  /**
   * **帳票での見え方**（太字・下線・カラー）。帳票のときだけ入る。
   *
   * 画面の `appearance` とは**別物**——帳票に `DSPATR` は無く（実機は通さない）、
   * `COLOR` は名前の集合が違う（`BLK` / `BRN` があり `WHT` が無い）。
   * 画面の表を当てると帳票にしかない色が読めないので、分けて持つ。
   */
  readonly printAppearance?: PrintAppearance;
  /**
   * 何ページ目の項目か（帳票のみ・1 始まり）。
   *
   * 後戻りするスキップでページが増える（原典 `LPI`）。全ページ分をモデルに持ち、
   * **描くときに 1 ページ分へ絞る**（`selectPrintPage`）——ページを替えるたびに
   * ホストへ作り直しを頼むと、往復のあいだ絵が消える。
   */
  readonly page?: number;
  /**
   * キーワード欄を**条件ごとに**分けたもの。
   *
   * `attributes.keywords`（全部の連結）と違い、**どのキーワードがどの条件で効くか**を持つ。
   * 標識を倒したときに見え方を作り直すのに要る（`applyIndicators`）。
   * 条件の付いた群が 1 つも無ければ、倒しても見え方は変わらない。
   */
  readonly keywordGroups: readonly KeywordGroup[];
  /**
   * 条件付け（7-16 桁）。**ここでは解決しない。**
   *
   * どの標識が立っているかは**利用者が指定する表示の状態**で、ソースには書かれていない。
   * モデルに解決済みの真偽を載せると、状態が変わるたびにホストへ作り直しを頼むことになる。
   * 規則（`evaluateConditioning`）は core に置いたまま、状態は UI が持つ。
   */
  readonly condition: Conditioning;
}

/**
 * 翻訳の入力。DSPF / PRTF の配置解決が返す項目が**どちらもこの形を満たす**。
 */
export interface PlacedSource {
  readonly kind: "field" | "constant";
  readonly name?: string;
  readonly text?: string;
  readonly row: number;
  readonly column: number;
  /** 何ページ目か（帳票）。 */
  readonly page?: number;
  readonly width: number | undefined;
  readonly recordName?: string;
  readonly sourceLine: number;
  readonly usage?: string;
  readonly dataType?: string;
  readonly decimals?: number;
  readonly keywords: string;
  readonly keywordGroups: readonly KeywordGroup[];
  readonly conditioning: Conditioning;
  readonly occupancy: { readonly start: number; readonly end: number };
  /**
   * 行が**行送り**（`SPACE` / `SKIP`）で決まるか。PRTF だけ true になりうる。
   *
   * true の項目に行番号を書き込むと `SPACE` / `SKIP` が**無効になる**ので、
   * 行を変える移動は拒否する（`ddsEdit`）。UI は縦のドラッグを止める。
   */
  readonly rowFromSpacing?: boolean;
}

/** 翻訳の付帯情報。**帳票のときだけ要る**もの。 */
export interface RenderItemOptions {
  /**
   * 帳票として解く。`printAppearance` が入り、画面用の `appearance` は既定のまま。
   *
   * 帳票のキーワードを画面の表で読むと**取り違える**（`COLOR(BRN)` が読めず、
   * `COLOR(WHT)` を読めてしまう）ので、種別で分ける。
   */
  readonly print?: boolean;
  /**
   * 様式のキーワード欄。**`HIGHLIGHT` は様式に書くと全項目に効く**（原典）ので、
   * 項目だけを見ると太字を取りこぼす。
   */
  readonly recordKeywords?: string;
}

export function toRenderItem(item: PlacedSource, options: RenderItemOptions = {}): RenderItem {
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
    // **標識が未設定の状態**で解く。未設定は「決まらない」＝効かせるので、
    // 条件つきキーワードも既定では効く（＝これまでと同じ見え方）。
    // **画面の表は帳票に当てない。** 帳票は `printAppearance` を持つ。
    appearance: options.print
      ? DEFAULT_APPEARANCE
      : resolveAppearanceUnder(item.keywordGroups, {}),
    ...(options.print
      ? {
          printAppearance: resolvePrintAppearance(item.keywords, options.recordKeywords ?? "")
        }
      : {}),
    keywordGroups: item.keywordGroups,
    condition: item.conditioning,
    ...(item.recordName !== undefined ? { recordName: item.recordName } : {}),
    ...(item.rowFromSpacing ? { rowFromSpacing: true } : {}),
    ...(item.page !== undefined ? { page: item.page } : {})
  };
}

/**
 * フィールドの見え方。SDA と同じ流儀で、長さと位置が分かる形にする。
 *
 * 実際に何が出るかは実行時のデータ次第なので、**名前ではなくプレースホルダ**を敷く
 * （名前を出すと、名前の長さと桁数が食い違って見える）。
 */
function placeholder(item: PlacedSource): string {
  const numeric = (item.name ?? "").length > 0 && isNumericLike(item);
  return (numeric ? "9" : "X").repeat(item.width ?? 0);
}

function isNumericLike(item: PlacedSource): boolean {
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
