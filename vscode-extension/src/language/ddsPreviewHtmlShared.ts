/**
 * プレビュー HTML の共通部品（帳票・画面で共有）。
 *
 * **vscode を import しない**（文字列を返すだけ）。
 * 目盛りとエスケープは PRTF / DSPF で同じものを使う（同じ概念を 2 か所に持たない）。
 */

/** 桁の目盛り。`....+....1....+....2` の形（SEU と同じ読み方）。 */
export function buildRuler(columns: number): string {
  let ruler = "";
  for (let column = 1; column <= columns; column += 1) {
    if (column % 10 === 0) {
      ruler += String((column / 10) % 10);
    } else if (column % 5 === 0) {
      ruler += "+";
    } else {
      ruler += ".";
    }
  }
  return ruler;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
