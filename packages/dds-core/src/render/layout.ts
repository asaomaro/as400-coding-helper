/**
 * アイテムの配置計算。**ASCII レンダラと GUI 向け `RenderModel` の共通の土台。**
 *
 * ## なぜ切り出してあるか
 *
 * design は「`render/ascii` と `render/model` は**同じ配置計算**を使う」と定めている。
 * これを散文の約束にしておくと、片方だけ直したときに黙って食い違う——
 * **ゴールデンは緑のまま GUI だけ桁がずれる**、という最も気付きにくい壊れ方をする。
 *
 * そこで配置計算をこのモジュール 1 か所に置き、両方がここを通る構造にした。
 * これにより **05 で取れた実機ゴールデンの一致（AC5 / AC6）が、そのまま GUI の配置の担保になる**。
 *
 * ## セルの表現は実機のグリッドに合わせてある（`render/ascii` のコメント参照）
 *
 * | 要素 | セル |
 * |---|---|
 * | 全角文字 | **1 文字ぶんのセルを占め、次のセルは空白**（2 表示桁を「文字＋空白」で表す） |
 * | SO / SI | **空白**（桁は消費するが可視文字にならない） |
 * | フィールド | プレースホルダの反復（英数字 `X` / 数値 `9`。SDA と同じ流儀） |
 *
 * **画面の桁方向のはみ出しはここで切らない。** ASCII はグリッドへ書くときに切り、
 * DOM は CSS で切る——切り方が利用者ごとに違うため、ここでは「どこに何桁ぶん置くか」までを返す。
 */

import type { DdsDoc, DdsItem, ItemLine } from "../dds/model.js";
import { isDbcsCodePoint } from "../text/encoding.js";
import {
  itemContentWidth,
  isNumericField,
  DEFAULT_SCREEN,
  type ScreenSize
} from "../dds/validate.js";

/** 英数字フィールドのプレースホルダ（SDA と同じ流儀）。 */
export const ALPHA_PLACEHOLDER = "X";
/** 数値フィールドのプレースホルダ。 */
export const NUMERIC_PLACEHOLDER = "9";

/**
 * 描画の 1 区切り。
 *
 * SO / SI は `text` が空の 1 桁ぶんの区切りになる（桁は消費するが可視文字にならない）。
 */
export interface Segment {
  /** 描く文字列。空なら空白のまま空ける。 */
  readonly text: string;
  /** 占有する表示桁数。 */
  readonly cols: number;
}

/** 画面上に置かれた 1 アイテム。 */
export interface Placement {
  readonly item: DdsItem;
  /** 画面上の行（1 始まり）。 */
  readonly line: number;
  /** 画面上の桁（1 始まり・表示桁）。 */
  readonly pos: number;
  /**
   * 画面に**見える内容**の表示桁数（符号位置を含まない）。
   *
   * 符号位置は占有はするが画面では空白なので、描く幅には含めない（06 `decisions.md` D4）。
   */
  readonly widthCols: number;
  /** 各表示桁に描く文字。長さは `widthCols` と一致する。 */
  readonly cells: readonly string[];
  /**
   * 描画の区切り。`cols` の合計は `widthCols` と一致する。
   *
   * **DOM で描く利用者のために core が用意する**（design DD3）。
   * WebView が文字を見て「これは全角か」を判断し始めると換算が 2 か所になるので、
   * **文字と占有桁数の対応はここで決めて渡す**。UI は `cols * セル幅` で箱を作るだけでよい。
   */
  readonly segments: readonly Segment[];
  /** 描画用テキスト。定数はリテラルそのもの、フィールドはプレースホルダの反復。 */
  readonly text: string;
}

/** 配置計算の指定。意味は `render/ascii` の `RenderOptions` と同じ。 */
export interface PlacementOptions {
  readonly record?: string;
  readonly allRecords?: boolean;
  readonly screen?: ScreenSize;
}

/**
 * 描画対象のアイテムを配置順に返す。
 *
 * 除外するもの（いずれも**黙って落とすのではなく `validate` が診断を出す**）:
 *
 * - 行 / 桁が書かれていないアイテム（画面に置かれていない）。
 * - 画面の行範囲の外にあるアイテム（`DDS7104`）。
 * - 幅を判定できないアイテム（参照フィールド等。`DDS7107`）。
 */
export function placements(
  doc: DdsDoc,
  options: PlacementOptions = {}
): Placement[] {
  const screen = options.screen ?? DEFAULT_SCREEN;

  // **省略時は最初の様式。** DSPF は複数の様式が同じ領域を使うのが普通で、
  // すべて重ねると潰れて「どちらの内容か分からない絵」になる（05 review should-2）。
  const record = options.allRecords === true
    ? undefined
    : options.record ?? doc.records[0]?.name;

  const result: Placement[] = [];

  for (const line of doc.lines) {
    if (line.kind !== "item") {
      continue;
    }
    const item = (line as ItemLine).item;
    if (item.line === undefined || item.pos === undefined) {
      continue;
    }
    if (record !== undefined && item.record !== record) {
      continue;
    }
    if (item.line < 1 || item.line > screen.rows) {
      continue;
    }
    const placement = placementOf(item, item.line, item.pos);
    if (placement !== undefined) {
      result.push(placement);
    }
  }

  return result;
}

/**
 * 1 アイテムの配置を求める。幅を判定できないアイテムは `undefined`。
 *
 * **幅 0 と決めつけない。** 0 にすると桁溢れも隣接も素通りし、
 * 「検証できないものを検証したふり」になる（`itemContentWidth` のコメント参照）。
 */
export function placementOf(
  item: DdsItem,
  line: number,
  pos: number
): Placement | undefined {
  const widthCols = itemContentWidth(item);
  if (widthCols === undefined) {
    return undefined;
  }

  if (item.kind === "constant") {
    const text = item.text ?? "";
    const drawn = constantDrawing(text);
    return {
      item,
      line,
      pos,
      widthCols,
      cells: drawn.cells,
      segments: drawn.segments,
      text
    };
  }

  // **35 桁だけを見てはいけない。** 35 桁が空白でも小数桁があれば数値
  // （実機の "Expanded Source" が S に展開する）。判定は validate に一本化してある。
  const placeholder = isNumericField(item)
    ? NUMERIC_PLACEHOLDER
    : ALPHA_PLACEHOLDER;
  const text = placeholder.repeat(widthCols);

  return {
    item,
    line,
    pos,
    widthCols,
    cells: new Array<string>(widthCols).fill(placeholder),
    // フィールドはプレースホルダの反復なので 1 区切りで足りる。
    segments: widthCols > 0 ? [{ text, cols: widthCols }] : [],
    text
  };
}

/**
 * 定数のセル列と区切りを、1 度の走査で作る。
 *
 * **SO / SI は桁を消費するが可視文字にはならない**ので、空白のままセルを 1 つ進める。
 * 全角は開始セルに文字を置き、**次のセルは空白のまま**にする（実機のグリッドの形）。
 *
 * 区切り（`segments`）は同じ種別の連続をまとめる。全角の連なりは 1 区切り（`cols` は 2 倍）、
 * 半角の連なりも 1 区切り。**同じ走査から作るので、セルと区切りが食い違うことはない。**
 *
 * 返すセル数は `displayWidth(text)`（= 定数の `itemContentWidth`）と一致する。
 */
function constantDrawing(text: string): {
  cells: string[];
  segments: Segment[];
} {
  const cells: string[] = [];
  const segments: Segment[] = [];
  let inDbcs = false;
  let run = "";
  let runCols = 0;

  const flushRun = (): void => {
    if (runCols > 0) {
      segments.push({ text: run, cols: runCols });
      run = "";
      runCols = 0;
    }
  };
  const blank = (): void => {
    flushRun();
    cells.push(" ");
    segments.push({ text: "", cols: 1 });
  };

  let index = 0;
  while (index < text.length) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    const dbcs = isDbcsCodePoint(codePoint);
    const codeUnitLength = codePoint > 0xffff ? 2 : 1;

    if (dbcs && !inDbcs) {
      blank(); // SO
      inDbcs = true;
    } else if (!dbcs && inDbcs) {
      blank(); // SI
      inDbcs = false;
    }

    const char = text.slice(index, index + codeUnitLength);
    cells.push(char);
    run += char;
    runCols += dbcs ? 2 : 1;
    if (dbcs) {
      cells.push(" "); // 全角の 2 桁目。実機のグリッドでも空白になる。
    }

    index += codeUnitLength;
  }

  if (inDbcs) {
    blank(); // 末尾の SI
  }
  flushRun();

  return { cells, segments };
}
