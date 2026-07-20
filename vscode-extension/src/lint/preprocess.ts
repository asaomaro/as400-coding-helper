/**
 * 行の分類。**除外は規則ではなく前処理で行う。**
 *
 * 規則ごとに「注記行は除く」を書くと同じ判定が散らばり、片方だけ直る事故が起きる。
 * ここで 1 度だけ決め、規則には「この行を定位置として読んでよいか」の結果だけ渡す。
 *
 * 判定条件はいずれも原典由来（research.md F5 / F2）。
 */

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

/**
 * DDS の注記。原典 `物理ファイルおよび論理ファイルの注記 (7 桁目)` より:
 *   「7 桁目にアスタリスク (*) を入力すると、その行は注記として扱われ、
 *     8 から 80 桁目が注記本文として使用されます。
 *     ブランク行 (7 から 80 桁目に文字がまったく指定されていない行) も、
 *     注記として扱われます。」
 *
 * 既存コード（positionResolver / ruler / ddsKeywordCompletion）は `*` しか
 * 見ていないので、ブランク行の条件はここで足している。
 */
function isDdsComment(text: string): boolean {
  if (text.length > 6 && text.charAt(6) === "*") {
    return true;
  }
  // 7-80 桁が全て空白ならブランク行＝注記。
  return text.slice(6, 80).trim().length === 0;
}

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
  // charAt は範囲外で "" を返す（undefined にはならない）。
  const nameType = text.charAt(16);
  const name = text.slice(18, 28);
  return nameType.trim().length === 0 && name.trim().length === 0;
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
    if (isDdsComment(text)) return "comment";
    if (isDdsContinuation(text)) return "continuation";
    return "checked";
  }

  if (isRpgComment(text)) return "comment";
  // 6 桁目の仕様書コードが読めない行は定位置として扱えない。
  if (!specKeyword) return "skipped";
  if (isRpgContinuation(text, specKeyword)) return "continuation";
  return "checked";
}
