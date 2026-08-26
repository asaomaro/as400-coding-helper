/**
 * DDS 固定長の桁レイアウトと、行から各欄を切り出すヘルパ。
 *
 * ## 桁割りの根拠
 *
 * 実機（`ASAOLIB/QDDSSRC`）の実ソースを 1 桁ずつ検証して確認した（research F8）。
 * IBM 原典そのものではなく**実ソースによる裏付け**である点に注意
 * （原典は未収集。キーワードの意味解釈に踏み込む L3 の前に収集が要る）。
 *
 * ## 切り出しは換算層を通す
 *
 * 桁 1-44 は実務上つねに SBCS なので「桁 = 文字索引 + 1」が成り立つが、
 * **機能欄（45 桁以降）には DBCS リテラルが入る**。素朴な添字を使うと定数の範囲を誤るため、
 * `sourceColumnToCharIndex`（`text/encoding`）を通す。
 */

import { sourceColumnToCharIndex, displayWidth } from "../text/encoding.js";

/** 桁範囲（1 始まり・両端含む）。 */
export interface ColumnRange {
  readonly start: number;
  readonly end: number;
}

/** DDS の固定長桁割り（1 始まり・両端含む）。 */
export const DDS_COLUMNS = {
  /** フォーム型。DDS は `A`。 */
  formType: { start: 6, end: 6 },
  /** 条件（標識）。 */
  conditions: { start: 7, end: 16 },
  /** 型。レコード様式は `R`。 */
  type: { start: 17, end: 17 },
  /** 名前。 */
  name: { start: 19, end: 28 },
  /** 長さ（右詰）。 */
  length: { start: 30, end: 34 },
  /** データ型。 */
  dataType: { start: 35, end: 35 },
  /** 小数。 */
  decimals: { start: 36, end: 37 },
  /** 使用（I/O/B/H）。 */
  usage: { start: 38, end: 38 },
  /** 画面上の行。 */
  line: { start: 39, end: 41 },
  /** 画面上の桁。 */
  pos: { start: 42, end: 44 },
  /** 機能キーワード。 */
  functions: { start: 45, end: 80 }
} as const satisfies Record<string, ColumnRange>;

/** DDS ソース行の標準的な桁数。 */
export const DEFAULT_LINE_WIDTH = 80;

/**
 * 行から指定桁範囲を切り出す（前後の空白は落とさない）。
 *
 * 行が短くて範囲に届かない場合は、届いた分だけを返す（空文字になりうる）。
 */
export function sliceColumns(raw: string, range: ColumnRange): string {
  const from = sourceColumnToCharIndex(raw, range.start);
  const to = sourceColumnToCharIndex(raw, range.end + 1);
  return raw.slice(from.index, to.index);
}

/** 行から指定桁範囲を切り出し、前後の空白を落とす。 */
export function fieldAt(raw: string, range: ColumnRange): string {
  return sliceColumns(raw, range).trim();
}

/** 数値欄を切り出す。空欄や数値でない場合は undefined。 */
export function numberAt(raw: string, range: ColumnRange): number | undefined {
  const text = fieldAt(raw, range);
  if (text === "") {
    return undefined;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** 行の表示桁数。 */
export function lineDisplayWidth(raw: string): number {
  return displayWidth(raw);
}

/**
 * 機能欄の先頭にある引用符付きリテラルを取り出す。
 *
 * DDS のリテラルは単一引用符で囲み、内部の引用符は 2 個重ねる。
 * 取り出せない場合は undefined（キーワードなど）。
 */
export function literalFromFunctions(functions: string): string | undefined {
  const text = functions.trimStart();
  if (!text.startsWith("'")) {
    return undefined;
  }

  let out = "";
  let index = 1;
  while (index < text.length) {
    const ch = text[index];
    if (ch === "'") {
      if (text[index + 1] === "'") {
        // 2 個重ねは 1 個の引用符を表す。
        out += "'";
        index += 2;
        continue;
      }
      return out; // 閉じ引用符
    }
    out += ch;
    index += 1;
  }

  // 閉じられていない（継続行へ続くなど）。取り出せた分を返す。
  return out;
}
