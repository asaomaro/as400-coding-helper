/**
 * DBCS（全角）の判定と、**実機での印刷桁数**の計算。
 *
 * このモジュールは **vscode を import しない**。SOSI 表示（`dbcsShiftMarkers`）と
 * 帳票プレビュー（`dds/prtfLayout`）が同じ判定を使うために置いている。
 * 片方だけ直すと「ルーラーでは合っているのにプレビューがずれる」が起きる。
 */

import { DBCS_RANGES_IBM939 } from "./dbcsTable";

/**
 * その符号位置を DBCS（全角）とみなすか。
 *
 * まず **実機の変換表**（CCSID 5035 = IBM-939、`dbcsTable.ts`）で引く。罫線 `─`・
 * `■`・`※`・`「」`・ギリシャ文字など、見た目からは分かりにくい DBCS もここで拾う。
 * 変換表に無い文字（CJK 拡張など。実機では置換文字になる）は、全角系の範囲なら DBCS とする。
 */
export function isDbcsCodePoint(codePoint: number): boolean {
  if (inRanges(DBCS_RANGES_IBM939, codePoint)) return true;

  return (
    (codePoint >= 0x3040 && codePoint <= 0x30ff) || // Hiragana/Katakana
    (codePoint >= 0x3400 && codePoint <= 0x9fff) || // CJK Unified Ideographs + Ext.A
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
    (codePoint >= 0xff01 && codePoint <= 0xff60) || // Fullwidth ASCII variants
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) || // Fullwidth currency etc.
    codePoint >= 0x20000 // CJK Ext.B 以降
  );
}

/** [開始, 終了] を平たく並べた昇順の配列を二分探索する。 */
function inRanges(ranges: readonly number[], codePoint: number): boolean {
  let low = 0;
  let high = ranges.length / 2 - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (codePoint < ranges[middle * 2]) high = middle - 1;
    else if (codePoint > ranges[middle * 2 + 1]) low = middle + 1;
    else return true;
  }
  return false;
}

/**
 * 実機での印刷桁数を求める。
 *
 * **ローカルのソースに SO/SI は存在しない。** `.pf` を生バイトで見ると日本語は
 * UTF-8 のまま入っており（`346 274 242` = `漢`）、`0x0E`/`0x0F` は無い。
 * `dbcsShiftMarkers` が `{` `}` を見せているのは装飾で、文字としては無い。
 *
 * 一方、実機のメンバー上では DBCS の連なりの前後に SO と SI が 1 桁ずつ入り、
 * 全角 1 文字は 2 桁を占める。**ソースに無い分を計算で足す**のがこの関数の役目。
 *
 * ```
 *   'ABC'        → 3
 *   '顧客一覧表'  → SO(1) + 5*2 + SI(1) = 12
 *   'A顧客B'     → 1 + SO(1) + 2*2 + SI(1) + 1 = 8
 *   'あZい'      → SO(1)+2+SI(1) + 1 + SO(1)+2+SI(1) = 9
 * ```
 *
 * 最後の例のとおり、**DBCS が途切れるたびに SO/SI が要る**ので、
 * 全角の総数だけを数えても正しくならない。
 */
export function printWidth(text: string): number {
  let width = 0;
  let inDbcsRun = false;

  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;

    if (isDbcsCodePoint(codePoint)) {
      if (!inDbcsRun) {
        width += 1; // シフトアウト
        inDbcsRun = true;
      }
      width += 2;
      continue;
    }

    if (inDbcsRun) {
      width += 1; // シフトイン
      inDbcsRun = false;
    }
    width += 1;
  }

  if (inDbcsRun) {
    width += 1; // 行末までDBCSが続いた場合のシフトイン
  }

  return width;
}

/**
 * 実機の桁数が `max` を超え始める位置（**JS の添字**）。超えなければ undefined。
 *
 * `printWidth` は「全体で何桁か」しか答えないが、指摘の下線を引くには
 * **どこから溢れたか**が要る。エディタの列は JS の添字なので、桁とは別物。
 *
 * SO/SI の分は `printWidth` と同じ数え方（DBCS の連なりの前後に 1 桁ずつ）。
 */
export function indexExceedingWidth(text: string, max: number): number | undefined {
  let width = 0;
  let inDbcsRun = false;
  let index = 0;

  for (const character of text) {
    const codePoint = character.codePointAt(0);
    const dbcs = codePoint !== undefined && isDbcsCodePoint(codePoint);

    // この 1 文字を置いたら何桁になるか。DBCS の切れ目では SO / SI が入る。
    let next = width;
    if (dbcs) {
      if (!inDbcsRun) next += 1; // シフトアウト
      next += 2;
    } else {
      if (inDbcsRun) next += 1; // シフトイン
      next += 1;
    }
    // 行末の DBCS には必ずシフトインが要る。
    const closed = dbcs ? next + 1 : next;
    if (closed > max) return index;

    width = next;
    inDbcsRun = dbcs;
    index += character.length;
  }
  return undefined;
}

/**
 * 実機の 1 桁。DBCS の文字は `dbcs`（前半）と `tail`（後半）の 2 桁、その前後に `so` / `si` が 1 桁ずつ入る。
 *
 * エディタの文字列には SO/SI が無い（全角 1 文字も 1 文字）ので、固定長の欄を桁で読み書きするときは
 * **実機の桁に広げてから**切り貼りし、終わったら文字列に戻す。数え方は `printWidth` と同じ
 * （SOSI 表示の `{` `}` とも同じ）。
 */
interface MachineCell {
  readonly kind: "sbcs" | "dbcs" | "tail" | "so" | "si";
  readonly text: string;
}

function toMachineCells(text: string): MachineCell[] {
  const cells: MachineCell[] = [];
  let inDbcsRun = false;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && isDbcsCodePoint(codePoint)) {
      if (!inDbcsRun) cells.push({ kind: "so", text: "" });
      inDbcsRun = true;
      cells.push({ kind: "dbcs", text: character }, { kind: "tail", text: "" });
      continue;
    }
    if (inDbcsRun) cells.push({ kind: "si", text: "" });
    inDbcsRun = false;
    cells.push({ kind: "sbcs", text: character });
  }
  if (inDbcsRun) cells.push({ kind: "si", text: "" });
  return cells;
}

const BLANK_CELL: MachineCell = { kind: "sbcs", text: " " };

/**
 * 桁の並びを文字列に戻す。**半分だけ残った DBCS・相手の無い SO/SI は空白の 1 桁にする**
 * （欄の境目で DBCS の連なりを切ったとき。消すと後ろの桁が全部ずれる）。
 */
function fromMachineCells(cells: readonly MachineCell[]): string {
  let text = "";
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const previous = cells[index - 1];
    const next = cells[index + 1];
    switch (cell.kind) {
      case "sbcs":
        text += cell.text;
        break;
      case "dbcs":
        text += next?.kind === "tail" ? cell.text : " ";
        break;
      case "tail":
        if (previous?.kind !== "dbcs") text += " ";
        break;
      case "so":
        if (next?.kind !== "dbcs") text += " ";
        break;
      case "si":
        if (previous?.kind !== "tail") text += " ";
        break;
    }
  }
  return text;
}

/** 実機の桁（1 始まり）で切り出す。`length` を省くと行末まで。 */
export function sliceMachineColumns(text: string, start: number, length?: number): string {
  const cells = toMachineCells(text);
  const from = Math.max(0, start - 1);
  const slice = cells.slice(from, length === undefined ? undefined : from + length);
  // 切り口で半分になった DBCS は、切り出した側では空白として読む。
  return fromMachineCells(slice);
}

/** 実機の桁数に合わせて空白を足す（`end` は後ろ、`start` は前）。 */
export function padMachineColumns(text: string, width: number, side: "start" | "end" = "end"): string {
  const fill = " ".repeat(Math.max(0, width - printWidth(text)));
  return side === "start" ? fill + text : text + fill;
}

/**
 * 実機の桁（1 始まり）の `length` 桁を `value` で置き換える。`value` は実機の桁で `length` 桁に揃えてあること。
 * 行が短ければ空白で伸ばす。
 */
export function replaceMachineColumns(text: string, start: number, length: number, value: string): string {
  const cells = toMachineCells(text);
  while (cells.length < start - 1 + length) cells.push(BLANK_CELL);
  cells.splice(start - 1, length, ...toMachineCells(value));
  return fromMachineCells(cells);
}

/**
 * 実機の桁（1 始まり）が、エディタの何列目（1 始まり）に当たるか。指摘の下線を引くのに使う。
 *
 * SO は直後の全角の列、SI は直前の全角の次の列に当たる（エディタには SO/SI の文字が無い）。
 * 行末より後ろは 1 桁 1 列で伸ばす。
 */
export function editorColumnOfMachineColumn(text: string, machineColumn: number): number {
  let column = 0; // 実機の桁（0 始まり）
  let index = 0; // JS の添字
  let inDbcsRun = false;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    const dbcs = codePoint !== undefined && isDbcsCodePoint(codePoint);
    // この文字の前に入る SO / SI。どちらもこの文字の列に当てる。
    const shift = dbcs !== inDbcsRun ? 1 : 0;
    const width = shift + (dbcs ? 2 : 1);
    if (machineColumn - 1 < column + width) return index + 1;
    column += width;
    index += character.length;
    inDbcsRun = dbcs;
  }
  // 行末の SI の分を足してから、1 桁 1 列で伸ばす。
  if (inDbcsRun) column += 1;
  return index + 1 + Math.max(0, machineColumn - 1 - column);
}
