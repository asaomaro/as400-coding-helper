/**
 * 編集の写像。**`vscode` に触らない純関数だけを置く。**
 *
 * ## なぜ切り出してあるか
 *
 * 拡張の統合テストは CI に載せていない（表示環境が要る。親 plan「CI に載せるもの」）。
 * したがって **`vscode` に触らない形で切り出せた部分だけが機械的に守られる**。
 * AC2（編集行以外がバイト不変）を左右する「どの行を置き換えるか」の計算は、
 * この work で最も落としたくない箇所なので、ここに引き出してテストで固定する。
 *
 * ## 座標系を取り違えない（review must-1 の再発防止）
 *
 * `applyOps` が返す `changedLines` は**適用後テキストの座標**である。
 * これを旧文書の置換範囲として使うと、**行数が変わる操作（追加・削除）で壊れる**
 * ——削除では行が減らず、後続の行が複製される。
 * そこで旧文書側の終端は `新終端 + (旧行数 - 新行数)` で求める。
 */

import type { ChangedLines } from "@as400/dds-core";

/** 行単位の置換指示。**範囲は旧文書、内容は新テキスト**（0 始まり・終端は含まない）。 */
export interface LineReplacement {
  /** 置き換える旧文書の開始行。 */
  readonly startLine: number;
  /**
   * 置き換える旧文書の終端（含まない）。
   *
   * `startLine` と等しいなら**挿入**（旧文書の行を消さずに `lines` を差し込む）。
   */
  readonly endLineExclusive: number;
  /** 置換後の行（改行は含まない）。空なら**削除**。 */
  readonly lines: readonly string[];
}

/**
 * 適用前後のテキストから、置き換えるべき範囲と内容を求める。
 *
 * **全文置換にしない**ための計算（design DD6）。全文を差し替えると undo の粒度が壊れ、
 * 並べて開いたテキストエディタのカーソルが飛ぶ。
 *
 * 変更が無ければ `undefined` を返す（呼び出し側は編集そのものを行わない）。
 */
export function lineReplacement(
  oldText: string,
  newText: string,
  changed: ChangedLines
): LineReplacement | undefined {
  const newLines = splitLines(newText);
  const oldCount = splitLines(oldText).length;

  const startLine = clamp(changed.start, 0, Math.min(oldCount, newLines.length));
  const newEnd = clamp(changed.end, startLine, newLines.length);

  // 行数の増減ぶんだけ、旧文書側の終端をずらす。
  // 削除（旧 > 新）なら旧側を長く、挿入（旧 < 新）なら旧側を短く取る。
  const delta = oldCount - newLines.length;
  const endLineExclusive = clamp(newEnd + delta, startLine, oldCount);

  const lines = newLines.slice(startLine, newEnd);
  if (endLineExclusive === startLine && lines.length === 0) {
    return undefined; // 置き換えるものも差し込むものも無い。
  }

  return { startLine, endLineExclusive, lines };
}

/**
 * テキストを行へ分ける。**末尾の改行で空行を増やさない。**
 *
 * `"A\nB\n"` は 2 行。ここで 3 行目（空文字）を作ると、置換範囲が 1 行ずれる。
 * （VSCode の `TextDocument.lineCount` は末尾改行のぶん 1 多く数える点に注意——
 * 行番号 0..n-1 の対応は一致するので、この差は挿入位置の計算でだけ効く。）
 */
export function splitLines(text: string): string[] {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const body = text.endsWith(eol) ? text.slice(0, -eol.length) : text;
  return body === "" ? [] : body.split(eol);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
