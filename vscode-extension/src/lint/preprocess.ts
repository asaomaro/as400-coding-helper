/**
 * 行の分類。**除外は規則ではなく前処理で行う。**
 *
 * 規則ごとに「注記行は除く」を書くと同じ判定が散らばり、片方だけ直る事故が起きる。
 * ここで 1 度だけ決め、規則には「この行を定位置として読んでよいか」の結果だけ渡す。
 *
 * 判定条件はいずれも原典由来（research.md F5 / F2）。
 */

import {
  DDS_COLUMNS,
  ddsField,
  ddsName,
  isDdsBlankLine,
  isDdsCommentLine
} from "../core/ddsLayout";

export type LineKind =
  /** 注記行。定位置の意味を持たない。 */
  | "comment"
  /** 継続記入行。定位置の欄は無いが桁数の上限は効く。 */
  | "continuation"
  /** 定位置として読んでよい行。 */
  | "checked"
  /** 種別が決まらないなど、検査対象にしない行。 */
  | "skipped";

export type LintLanguage = "rpg-fixed" | "dds";

/** RPG の注記は 7 桁目の `*`。空行も定位置として読む意味が無い。 */
function isRpgComment(text: string): boolean {
  if (text.trim().length === 0) {
    return true;
  }
  return text.length > 6 && text.charAt(6) === "*";
}

/**
 * DDS のキーワードのみの行（17 桁目も名前欄も空）。
 * 直前のレコード／フィールドの続きで、定位置の欄は書かれていない。
 */
function isDdsContinuation(text: string): boolean {
  const nameType = ddsField(text, DDS_COLUMNS.nameType);
  return nameType.trim().length === 0 && ddsName(text).length === 0;
}

/**
 * RPG の F / D 仕様書のキーワード継続記入行（7-16 桁が空）。
 * 原典 `ファイル記述のキーワード` より:
 *   「ファイル記述キーワードに追加のスペースが必要な場合には、
 *     キーワード・フィールドを後続の行に継続させることができます。」
 * D 仕様書にも同じ仕組みがある（継続名前行を含む）。
 */
function isRpgContinuation(text: string, specKeyword: string | undefined): boolean {
  if (specKeyword !== "F-SPEC" && specKeyword !== "D-SPEC") {
    return false;
  }
  return text.slice(6, 16).trim().length === 0;
}

export function classifyLine(
  text: string,
  language: LintLanguage,
  specKeyword: string | undefined
): LineKind {
  if (language === "dds") {
    // 原典はブランク行も注記として扱う。素の判定は ddsLayout が持ち、
    // 「定位置として読めるか」の組み立てはここで行う（補完は空行でも候補を出したい）。
    if (isDdsCommentLine(text) || isDdsBlankLine(text)) return "comment";
    if (isDdsContinuation(text)) return "continuation";
    return "checked";
  }

  if (isRpgComment(text)) return "comment";
  // 6 桁目の仕様書コードが読めない行は定位置として扱えない。
  if (!specKeyword) return "skipped";
  if (isRpgContinuation(text, specKeyword)) return "continuation";
  return "checked";
}
