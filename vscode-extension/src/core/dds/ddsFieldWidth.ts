import { DDS_COLUMNS, ddsField } from "../ddsLayout";
import { printWidth } from "../dbcs";
import { readNumber } from "./ddsLogicalUnits";
import { editedWidth } from "./editCode";

/**
 * 項目の幅（実機での桁数）を求める。**印刷装置・表示装置に共通**。
 *
 * ■ 幅は `.length` では求まらない
 *   実機は DBCS の前後に SO / SI を挿入するので、JS の文字数と桁数が食い違う。
 *   幅の計算は必ず `printWidth` を通す（競合の拡張が 6 桁ずれているのがこの失敗）。
 *
 * ■ 分からないときは分からないと言う
 *   参照フィールド（29 桁目の `R`）は参照先を解決しないと幅が出ない。
 *   推測で描くと桁がずれた絵になるので、`undefined` を返して理由を添える。
 */

export type WidthUnknownReason =
  | "reference"
  | "user-defined-edit-code"
  | "not-numeric"
  | "no-length";

export interface ResolvedWidth {
  readonly width: number | undefined;
  readonly reason?: WidthUnknownReason;
}

/**
 * 定数（固定情報フィールド）の幅。
 *
 * 原典（`桁数 (30 - 34 桁目)`）:
 * > 固定情報フィールドについては、フィールドの桁数を指定してはなりません。
 *
 * 桁数欄を持たないので、リテラル本体から求める。
 */
export function constantWidth(text: string): ResolvedWidth {
  return { width: printWidth(text) };
}

/**
 * フィールドの幅を、定位置欄とキーワード欄から求める。
 *
 * @param line 項目の代表行
 * @param keywords 代表行＋継続行のキーワード欄
 */
export function fieldWidth(line: string, keywords: string): ResolvedWidth {
  // 29 桁目の R は参照フィールド。参照先を解決しないので幅は出せない。
  if (ddsField(line, DDS_COLUMNS.reference).trim().toUpperCase() === "R") {
    return { width: undefined, reason: "reference" };
  }

  const length = readNumber(ddsField(line, DDS_COLUMNS.length));
  if (length === undefined) {
    // 桁数欄が `+7` / `-7`（参照フィールドの増減形）のときもここに来る。
    // 参照先が分からないので幅は出せない。
    return { width: undefined, reason: "no-length" };
  }

  const editMatch = /\bEDTCDE\s*\(\s*([0-9A-Za-z])\s*([^)]*)\)/u.exec(keywords);
  if (!editMatch) return { width: length };

  const decimals = readNumber(ddsField(line, DDS_COLUMNS.decimals)) ?? 0;
  const dataType = ddsField(line, DDS_COLUMNS.dataType);
  const edited = editedWidth(length, decimals, editMatch[1], editMatch[2], dataType);
  if (edited.kind === "width") return { width: edited.width };

  return {
    width: undefined,
    reason:
      edited.reason === "user-defined"
        ? "user-defined-edit-code"
        : edited.reason === "not-numeric"
          ? "not-numeric"
          : "no-length"
  };
}
