import { PRTF_POSITION_COLUMN, PRTF_POSITION_ROW } from "./prtfColumns";

/**
 * 帳票プレビューで項目を動かしたときの、ソース行への書き戻し。
 *
 * **vscode を import しない**（文字列 → 文字列）。行が壊れないことを
 * 単体テストで確かめられるようにするため。
 *
 * ■ 位置欄だけを置き換える
 *   `prompter/applyChanges.ts` と同じ流儀で、指定した桁の範囲だけを差し替え、
 *   **他の桁には触れない**。行が短ければ必要な分だけ空白で伸ばす。
 *
 * ■ 行も桁も右詰め
 *   原典（`桁数 (30 から 34 桁目)`）は数値欄について「右寄せで指定しなければ
 *   なりません」と書いており、位置欄も実サンプルが右詰めになっている。
 */

export interface WriteBackRequest {
  readonly line: string;
  /** 1 始まり。省略すると位置欄の行を空にする。 */
  readonly row?: number;
  /** 1 始まり。省略すると位置欄の桁を空にする。 */
  readonly column?: number;
}

/** 位置欄（39-44 桁）だけを書き換えた行を返す。 */
export function writeBackPosition(request: WriteBackRequest): string {
  let line = request.line;
  line = replaceColumns(line, PRTF_POSITION_ROW, format(request.row, 3));
  line = replaceColumns(line, PRTF_POSITION_COLUMN, format(request.column, 3));
  // 位置欄の書き換えで生まれた行末の空白は落とす（元の行と同じ姿に保つ）。
  return line.trimEnd();
}

/** 位置欄に行番号が書かれているか。書き戻しの確認に使う。 */
export function hasExplicitRow(line: string): boolean {
  return readColumns(line, PRTF_POSITION_ROW).trim().length > 0;
}

function format(value: number | undefined, width: number): string {
  if (value === undefined) return " ".repeat(width);
  const text = String(Math.trunc(value));
  // 桁に収まらない値は書かない（呼び出し側が範囲を検査する）。
  if (text.length > width) return text.slice(-width);
  return text.padStart(width, " ");
}

function readColumns(line: string, [start, end]: readonly [number, number]): string {
  return line.slice(start - 1, end);
}

function replaceColumns(
  line: string,
  [start, end]: readonly [number, number],
  replacement: string
): string {
  const startIndex = start - 1;
  const endIndex = end;
  // 行が短ければ、書き込む位置まで空白で伸ばす。
  const padded = line.length < endIndex ? line.padEnd(endIndex, " ") : line;
  return padded.slice(0, startIndex) + replacement + padded.slice(endIndex);
}
