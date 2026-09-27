import type { PrompterDefinition } from "./types";

/**
 * **定義仕様書の継続名前行**（ILE RPG）。15 桁を超える名前を `...` で行に分けて書く。
 *
 * 原典（`rzasd/dscntnm.htm`）:
 * > 部分名の終わりに省略符号 (...) をコーディングすると、任意の名前を複数行に継続できます。
 * > 名前は、7 から 21 桁目の中で開始する必要があり、77 桁目まで（80 桁目で終了する省略記号を付けて）の
 * > 任意の位置で終了することができます。名前の開始と省略記号の間にはブランクを挿入することはできません。
 * > 継続名前行がコーディングされた場合、主要定義行の名前記入項目はブランクのままになる場合があります。
 *
 * プロンプターは名前欄（7-21 桁）しか扱えず、15 桁を超える名前が書けなかった（2026-09-27 の実操作調査 P21。利用者の決定で対応）。
 * 読むときは主要定義行の上の継続名前行をつなぎ、書くときは 15 桁を超えたら継続名前行に分けて主要定義行の名前欄を空ける。
 *
 * このモジュールは **vscode を import しない**。
 */

const NAME_START = 6; // 7 桁目（0 始まり）
const NAME_WIDTH = 15;
/** 継続名前行に置ける名前の長さ（7-77 桁。78-80 桁が `...`）。 */
const CONTINUED_WIDTH = 71;

/** その定義が継続名前行を使う欄（`nameContinuation`）を持つか。持てばその欄の名前。 */
export function continuedNameParameter(definition: PrompterDefinition): string | undefined {
  return definition.parameters.find(parameter => parameter.attributes?.nameContinuation === true)?.name;
}

/** 継続名前行か（6 桁目が D、名前が 7-21 桁から始まり空白を挟まず `...` で終わる）。 */
export function isContinuedNameLine(line: string): boolean {
  if (line.charAt(5).toUpperCase() !== "D") return false;
  const body = line.slice(NAME_START, 80).replace(/\s+$/u, "");
  if (!body.endsWith("...")) return false;
  const start = body.search(/\S/u);
  if (start < 0 || start >= NAME_WIDTH) return false;
  const name = body.slice(start, -3);
  return name.length > 0 && !/\s/u.test(name);
}

/** `index` 行の上に続く継続名前行の先頭の行（無ければ `index`）。 */
export function continuedNameStart(lines: readonly string[], index: number): number {
  let start = index;
  while (start - 1 >= 0 && isContinuedNameLine(lines[start - 1])) start -= 1;
  return start;
}

/** 継続名前行と主要定義行の名前欄をつないだ名前。 */
export function readContinuedName(lines: readonly string[], index: number, mainName: string): string {
  const start = continuedNameStart(lines, index);
  const parts = lines.slice(start, index).map(line => line.slice(NAME_START, 80).trim().replace(/\.\.\.$/u, ""));
  return parts.join("") + mainName.trim();
}

/**
 * 名前を書く。15 桁以内なら主要定義行の名前欄に（継続名前行があれば消す）、超えたら継続名前行に分けて主要定義行の名前欄を空ける。
 * `from` は置き換える最初の行（継続名前行の先頭）、`text` はその行から `index` 行までを置き換える文字列。
 */
export function writeContinuedName(
  lines: readonly string[],
  index: number,
  name: string,
  buildMain: (original: string, name: string) => string
): { from: number; text: string } {
  const from = continuedNameStart(lines, index);
  const main = lines[index] ?? "";
  const trimmed = name.trim();
  if (trimmed.length <= NAME_WIDTH) {
    // 継続名前行があれば消し、名前は主要定義行の名前欄へ（字下げは元の行のまま）。
    return { from, text: buildMain(main, trimmed) };
  }
  const prefix = `${main.slice(0, 5).padEnd(5, " ")}D`;
  const continued: string[] = [];
  for (let at = 0; at < trimmed.length; at += CONTINUED_WIDTH) {
    continued.push(`${prefix}${trimmed.slice(at, at + CONTINUED_WIDTH)}...`);
  }
  return { from, text: [...continued, buildMain(blankName(main), "")].join("\n") };
}

function blankName(line: string): string {
  const padded = line.padEnd(NAME_START + NAME_WIDTH, " ");
  return (padded.slice(0, NAME_START) + " ".repeat(NAME_WIDTH) + padded.slice(NAME_START + NAME_WIDTH)).replace(/\s+$/u, "");
}
