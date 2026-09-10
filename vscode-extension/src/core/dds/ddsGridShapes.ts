/**
 * 罫線・枠のキーワード引数 ⇔ 構造化データの相互変換。
 *
 * DSPF（`GRDLIN`/`GRDBOX`）と PRTF（`LINE`/`BOX`）の両方を持つ。
 * ここが受け取るのは `parseKeywordEntries`（`ddsKeywords.ts`）が既に切り出した
 * **1 キーワード分の括弧の中身**（`KeywordEntry.parameters`）——キーワード欄全体の
 * 分割はここではしない（写さない。`20260908-dds-ruled-lines` design.md 方針A）。
 *
 * ## 原典の構文
 *
 * `GRDLIN`/`GRDBOX` は原典から直読（2026-09-10、`docs/origin/dds/detail/
 * rzakc_rzakcmstdfgrd{l,b}.htm`）:
 * - `GRDLIN((*POS([*DS3][*DS4] start-line start-column length))
 *    [(*TYPE type [repeat][interval])] [(*COLOR ...)] [(*LINTYP ...)] [(*CONTROL ...)])`
 *   `*TYPE` の有効値 `UPPER`(既定)/`LOWER`/`RIGHT`/`LEFT`。
 * - `GRDBOX((*POS([*DS3][*DS4] start-row start-column depth width))
 *    [(*TYPE type [hrule][vrule])] [(*COLOR ...)] [(*LINTYP ...)] [(*CONTROL ...)])`
 *   `*TYPE` の有効値 `PLAIN`(既定)/`VRT`/`HRZ`/`HRZVRT`。
 *
 * **`*COLOR`/`*LINTYP`/`*CONTROL`/`*TYPE` の付随値は読み捨てる**（このデザイナは
 * 位置・大きさだけを扱う。requirements の対象範囲どおり）。`GRDBOX` を読むとき
 * `*TYPE` が `PLAIN` 以外でも、描画は常に矩形として扱う——**罫線・枠のうち
 * 「どの辺を引くか」の変種までは表現しない**、既知の簡略化（design.md 方針B の
 * `GridBoxShape` に type が無いことに対応する）。
 *
 * PRTF の `BOX`/`LINE` は cm/inch 単位（`CRTPRTF` の `UOM`）で書かれるため、
 * `PrintDensity`（`prtfDensity.ts`。CPI/LPI の解決結果）を受け取って行・桁に
 * 変換し尽くす（design.md 方針C）。`UOM` 自体は DDS ソースに現れない
 * （`PAGESIZE`/`OVRFLW` と同じ「ホストが渡す」既定値の一つ。原典の実機既定は
 * `*INCH`——CL プロンプター定義 `CRTPRTF.json` の `UOM` の `defaultValue` で確認済み）。
 *
 * `BOX`/`LINE` の line-width は必須パラメータだが、位置・大きさの再現には使わない
 * ので読み捨て、書き出しは特殊値 `*MEDIUM`（原典が定義する既定的な太さの1つ）で
 * 固定する——数値でも書けるが、UI からの新規配置に既定の太さの決定は要らない。
 */
import { parseKeywordEntries } from "./ddsKeywords";
import type { PrintDensity } from "./prtfDensity";

/** 罫線・枠の変換に要るのは CPI/LPI だけ（`mixed`/`written` は不要）。 */
type PrtfDensity = Pick<PrintDensity, "cpi" | "lpi">;

/** `CRTPRTF` の `UOM` 既定（`*INCH`。原典の CL プロンプター定義で確認済み）。 */
export type PrtfUnitOfMeasure = "inch" | "cm";
const CM_PER_INCH = 2.54;

function toInches(value: number, uom: PrtfUnitOfMeasure): number {
  return uom === "cm" ? value / CM_PER_INCH : value;
}

function fromInches(inches: number, uom: PrtfUnitOfMeasure): number {
  return uom === "cm" ? inches * CM_PER_INCH : inches;
}

/** DSPF `GRDLIN` の `*TYPE`（境界の向き）。 */
export type GridLineEdge = "upper" | "lower" | "left" | "right";

export interface GridLineShape {
  /** 1 始まり。start-line 相当。 */
  readonly row: number;
  /** 1 始まり。start-column 相当。 */
  readonly column: number;
  /** `edge` が upper/lower なら桁数、left/right なら行数。 */
  readonly length: number;
  readonly edge: GridLineEdge;
}

export interface GridBoxShape {
  readonly row: number;
  readonly column: number;
  readonly depth: number;
  readonly width: number;
}

/** `RenderModel` に載せる罫線。どのキーワード欄（の代表行）から来たかを持つ。 */
export interface RenderGridLine extends GridLineShape {
  /** 1 始まり。この罫線を書いているキーワード欄の代表行（`items`/`records` と同じ鍵）。 */
  readonly sourceLine: number;
  /**
   * 何ページ目か（帳票のみ・1 始まり）。画面ファイルでは undefined。
   * `RenderItem.page` と同じ考え方——`selectPrintPage` がこれで絞る。
   */
  readonly page?: number;
}

/** `RenderModel` に載せる枠。同上。 */
export interface RenderGridBox extends GridBoxShape {
  readonly sourceLine: number;
  readonly page?: number;
}

/** どちらの画面サイズ（`*DS3`/`*DS4`）で解決するか。`dspfLayout.ts` の同名オプションと揃える。 */
export type ScreenSizeTarget = "primary" | "secondary";

interface ArgGroup {
  /** 先頭トークンの `*` を外し大文字化したもの（例 `POS`, `TYPE`）。 */
  readonly marker: string;
  readonly tokens: readonly string[];
}

/**
 * パラメータ文字列を、先頭が `*マーカー` のトップレベル括弧群に割る。
 *
 * `(*POS 3 10 5)(*TYPE UPPER)` → `[{marker:"POS",tokens:["3","10","5"]}, {marker:"TYPE",tokens:["UPPER"]}]`
 *
 * 括弧の深さを数えるだけの単純な走査（GRDLIN/GRDBOX/BOX/LINE の引数に
 * 引用符付き文字列は現れないため、`parseKeywordEntries` のような引用符考慮は不要）。
 */
function splitArgGroups(parameters: string): readonly ArgGroup[] {
  const groups: ArgGroup[] = [];
  let index = 0;

  while (index < parameters.length) {
    const ch = parameters[index];
    if (ch === undefined) break;
    if (/\s/u.test(ch)) {
      index += 1;
      continue;
    }
    if (ch !== "(") {
      // 想定外の文字（原典の書式ゆれ）は読み飛ばす。落ちるより余分に見る方が安全（AGENTS.md）。
      index += 1;
      continue;
    }

    let depth = 0;
    const start = index;
    while (index < parameters.length) {
      if (parameters[index] === "(") depth += 1;
      else if (parameters[index] === ")") {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          break;
        }
      }
      index += 1;
    }
    const inner = parameters.slice(start + 1, index - 1).trim();
    const tokens = inner.split(/\s+/u).filter(t => t.length > 0);
    if (tokens.length === 0) continue;

    groups.push({ marker: tokens[0].replace(/^\*/u, "").toUpperCase(), tokens: tokens.slice(1) });
  }

  return groups;
}

/**
 * `*POS` グループのトークンから、指定の個数の数値を読む。
 *
 * `*DS3`/`*DS4` プレフィックスの扱い（原典: 「使用中の画面サイズに応じて
 * 2 つの異なる…値をとります」）:
 * - プレフィックス無しの単純な数値列 → そのまま使う（画面サイズを問わない）。
 * - `*DS3 v1 v2 v3 *DS4 v1 v2 v3` のように両方あれば、`target` に一致する方を使う。
 * - 片方しか無ければ、それを使う（`target` との不一致は許容——書かれている方が唯一の情報源）。
 */
function readPositionNumbers(
  tokens: readonly string[],
  count: number,
  target: ScreenSizeTarget
): readonly number[] | undefined {
  if (tokens.length === count && tokens.every(t => /^\d+$/u.test(t))) {
    return tokens.map(Number);
  }

  const wanted = target === "secondary" ? "DS4" : "DS3";
  let fallback: readonly number[] | undefined;

  for (let i = 0; i < tokens.length; i += 1) {
    const marker = tokens[i]?.toUpperCase().replace(/^\*/u, "");
    if (marker !== "DS3" && marker !== "DS4") continue;

    const values = tokens.slice(i + 1, i + 1 + count);
    if (values.length === count && values.every(t => /^\d+$/u.test(t))) {
      const parsed = values.map(Number);
      if (marker === wanted) return parsed;
      fallback = fallback ?? parsed;
      // **値を実際に消費できたときだけ読み飛ばす。** 崩れた組（値が足りない・
      // 数値でない）で無条件に `count` 進めると、直後にある正しい組の
      // マーカーごと読み飛ばしてしまう（`*DS3 3 10 *DS4 5 15 8` で実際に踏んだ）。
      i += count;
    }
  }

  return fallback;
}

const GRDLIN_EDGES: ReadonlyMap<string, GridLineEdge> = new Map([
  ["UPPER", "upper"],
  ["LOWER", "lower"],
  ["RIGHT", "right"],
  ["LEFT", "left"]
]);

/** `GRDLIN` の引数（`KeywordEntry.parameters`）を読む。読めなければ `undefined`。 */
export function parseGrdlin(
  parameters: string,
  target: ScreenSizeTarget = "primary"
): GridLineShape | undefined {
  const groups = splitArgGroups(parameters);
  const pos = groups.find(g => g.marker === "POS");
  if (!pos) return undefined;

  const values = readPositionNumbers(pos.tokens, 3, target);
  if (!values) return undefined;
  const [row, column, length] = values;
  if (row < 1 || column < 1 || length < 1) return undefined;

  // *TYPE 省略時の既定は upper（原典: 「タイプ・パラメーターのデフォルトは、upper です」）。
  const type = groups.find(g => g.marker === "TYPE");
  const edgeToken = type?.tokens[0]?.toUpperCase();
  const edge = (edgeToken !== undefined ? GRDLIN_EDGES.get(edgeToken) : undefined) ?? "upper";

  return { row, column, length, edge };
}

/** `GridLineShape` から `GRDLIN(...)` の文字列を組み立てる（DSPF 用）。 */
export function buildGrdlin(shape: GridLineShape): string {
  const type = shape.edge.toUpperCase();
  return `GRDLIN((*POS ${shape.row} ${shape.column} ${shape.length})(*TYPE ${type}))`;
}

/** `GRDBOX` の引数を読む。読めなければ `undefined`。 */
export function parseGrdbox(
  parameters: string,
  target: ScreenSizeTarget = "primary"
): GridBoxShape | undefined {
  const groups = splitArgGroups(parameters);
  const pos = groups.find(g => g.marker === "POS");
  if (!pos) return undefined;

  const values = readPositionNumbers(pos.tokens, 4, target);
  if (!values) return undefined;
  const [row, column, depth, width] = values;
  if (row < 1 || column < 1 || depth < 1 || width < 1) return undefined;

  return { row, column, depth, width };
}

/** `GridBoxShape` から `GRDBOX(...)` の文字列を組み立てる（DSPF 用。`*TYPE` は既定の PLAIN）。 */
export function buildGrdbox(shape: GridBoxShape): string {
  return `GRDBOX((*POS ${shape.row} ${shape.column} ${shape.depth} ${shape.width}))`;
}

/**
 * レコードのキーワード欄（結合済み）から、`GRDLIN`/`GRDBOX` の occurrence を
 * まとめて読む。`parseKeywordEntries` で区切り、名前で振り分けるだけ
 * ——**新しい分割ロジックは作らない**（design.md 方針A）。
 */
export interface GridShapesInRecord {
  readonly lines: readonly GridLineShape[];
  readonly boxes: readonly GridBoxShape[];
}

export function readGridShapes(
  keywords: string,
  target: ScreenSizeTarget = "primary"
): GridShapesInRecord {
  const lines: GridLineShape[] = [];
  const boxes: GridBoxShape[] = [];

  for (const entry of parseKeywordEntries(keywords)) {
    if (entry.kind !== "keyword" || entry.parameters === undefined) continue;
    if (entry.name === "GRDLIN") {
      const shape = parseGrdlin(entry.parameters, target);
      if (shape) lines.push(shape);
    } else if (entry.name === "GRDBOX") {
      const shape = parseGrdbox(entry.parameters, target);
      if (shape) boxes.push(shape);
    }
  }

  return { lines, boxes };
}

// ============================================================================
// PRTF（BOX / LINE）— cm/inch と行・桁の変換を内包する。
// ============================================================================

/**
 * 原典（`BOX`/`LINE`。`docs/origin/dds/detail/rzakd_rzakdmstpt{box,line}.htm`）:
 * - `BOX(first-corner-down first-corner-across diagonal-corner-down
 *    diagonal-corner-across line-width [(*COLOR ...)])`——対角の2点＋線幅。全パラメータ必須。
 * - `LINE(position-down position-across line-length line-direction line-width
 *    [line-pad] [(*COLOR ...)])`——始点＋長さ＋方向(`*HRZ`/`*VRT`)＋線幅。
 * どちらも**単位は cm/inch**（`CRTPRTF` の `UOM`）——行・桁ではない。
 *
 * `first-corner-down`（行）は `prtfLayout.ts` の `Cursor` と同じ換算
 * （`row=1` は `inches=0`。`Cursor` の初期値 `{ row: 1, inches: 0 }` に合わせる）:
 * `row = round(inches * lpi) + 1` / 逆に `inches = (row - 1) / lpi`。桁も同様に CPI で換算する。
 */
function tokenizeMixed(text: string): readonly string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < text.length) {
    const ch = text[index];
    if (ch === undefined) break;
    if (/\s/u.test(ch)) {
      index += 1;
      continue;
    }
    if (ch === "(") {
      let depth = 0;
      const start = index;
      while (index < text.length) {
        if (text[index] === "(") depth += 1;
        else if (text[index] === ")") {
          depth -= 1;
          if (depth === 0) {
            index += 1;
            break;
          }
        }
        index += 1;
      }
      tokens.push(text.slice(start, index));
      continue;
    }
    const start = index;
    while (index < text.length && !/\s/u.test(text[index])) index += 1;
    tokens.push(text.slice(start, index));
  }

  return tokens;
}

/** `BOX` の引数を読み、行・桁に変換し尽くした `GridBoxShape` を返す。読めなければ `undefined`。 */
export function parsePrtfBox(
  parameters: string,
  density: PrtfDensity,
  uom: PrtfUnitOfMeasure = "inch"
): GridBoxShape | undefined {
  const tokens = tokenizeMixed(parameters);
  if (tokens.length < 5) return undefined;

  const [downA, acrossA, downB, acrossB] = tokens.slice(0, 4).map(Number);
  if (![downA, acrossA, downB, acrossB].every(Number.isFinite)) return undefined;

  const row = Math.round(toInches(downA, uom) * density.lpi) + 1;
  const column = Math.round(toInches(acrossA, uom) * density.cpi) + 1;
  const depth = Math.round(toInches(downB - downA, uom) * density.lpi);
  const width = Math.round(toInches(acrossB - acrossA, uom) * density.cpi);
  if (row < 1 || column < 1 || depth < 1 || width < 1) return undefined;

  return { row, column, depth, width };
}

/** `GridBoxShape` から `BOX(...)` を組み立てる。線幅は特殊値 `*MEDIUM` で固定する。 */
export function buildPrtfBox(
  shape: GridBoxShape,
  density: PrtfDensity,
  uom: PrtfUnitOfMeasure = "inch"
): string {
  const downA = (shape.row - 1) / density.lpi;
  const acrossA = (shape.column - 1) / density.cpi;
  const downB = downA + shape.depth / density.lpi;
  const acrossB = acrossA + shape.width / density.cpi;
  const fmt = (inches: number): string => fromInches(inches, uom).toFixed(3);

  return `BOX(${fmt(downA)} ${fmt(acrossA)} ${fmt(downB)} ${fmt(acrossB)} *MEDIUM)`;
}

/**
 * `LINE` の引数を読む。**PRTF は GRDLIN のような上下左右の区別を持たない**
 * （文字セル境界の概念が無い連続座標のため）。水平線は `upper`、垂直線は
 * `left` に正規化する——描画は「その行/桁に線を引く」ことだけを見るので、
 * 4値のうちどれに正規化しても表示上の扱いは変わらない（design.md 方針C）。
 */
export function parsePrtfLine(
  parameters: string,
  density: PrtfDensity,
  uom: PrtfUnitOfMeasure = "inch"
): GridLineShape | undefined {
  const tokens = tokenizeMixed(parameters);
  if (tokens.length < 4) return undefined;

  const down = Number(tokens[0]);
  const across = Number(tokens[1]);
  const rawLength = Number(tokens[2]);
  const direction = tokens[3]?.toUpperCase();
  if (![down, across, rawLength].every(Number.isFinite)) return undefined;
  if (direction !== "*HRZ" && direction !== "*VRT") return undefined;

  const isHorizontal = direction === "*HRZ";
  const row = Math.round(toInches(down, uom) * density.lpi) + 1;
  const column = Math.round(toInches(across, uom) * density.cpi) + 1;
  const length = Math.round(toInches(rawLength, uom) * (isHorizontal ? density.cpi : density.lpi));
  if (row < 1 || column < 1 || length < 1) return undefined;

  return { row, column, length, edge: isHorizontal ? "upper" : "left" };
}

/** `GridLineShape` から `LINE(...)` を組み立てる。線幅は特殊値 `*MEDIUM` で固定する。 */
export function buildPrtfLine(
  shape: GridLineShape,
  density: PrtfDensity,
  uom: PrtfUnitOfMeasure = "inch"
): string {
  const isHorizontal = shape.edge === "upper" || shape.edge === "lower";
  const down = (shape.row - 1) / density.lpi;
  const across = (shape.column - 1) / density.cpi;
  const length = shape.length / (isHorizontal ? density.cpi : density.lpi);
  const direction = isHorizontal ? "*HRZ" : "*VRT";
  const fmt = (inches: number): string => fromInches(inches, uom).toFixed(3);

  return `LINE(${fmt(down)} ${fmt(across)} ${fmt(length)} ${direction} *MEDIUM)`;
}

// ============================================================================
// RenderModel 向けの集約（`sourceLine` を刻む）
// ============================================================================

/** `RenderModel` が既に持つ様式一覧と同じ最小限の形（`dspfOutline`/PRTF 双方に合わせる）。 */
export interface KeywordRecord {
  readonly sourceLine: number;
  readonly keywords: string;
  /** PRTF のみ。この様式が実際に描かれるページ（呼び出し側が `layout.items` から求める）。 */
  readonly page?: number;
}

export interface CollectedGridShapes {
  readonly lines: readonly RenderGridLine[];
  readonly boxes: readonly RenderGridBox[];
}

/** DSPF: 複数レコードから `GRDLIN`/`GRDBOX` を集め、`sourceLine` を刻む。 */
export function collectDspfGridShapes(
  records: readonly KeywordRecord[],
  target: ScreenSizeTarget = "primary"
): CollectedGridShapes {
  const lines: RenderGridLine[] = [];
  const boxes: RenderGridBox[] = [];

  for (const record of records) {
    const found = readGridShapes(record.keywords, target);
    for (const line of found.lines) lines.push({ ...line, sourceLine: record.sourceLine });
    for (const box of found.boxes) boxes.push({ ...box, sourceLine: record.sourceLine });
  }

  return { lines, boxes };
}

/** PRTF: 複数レコードから `LINE`/`BOX` を集め、`sourceLine` を刻む。 */
export function collectPrtfGridShapes(
  records: readonly KeywordRecord[],
  density: PrtfDensity,
  uom: PrtfUnitOfMeasure = "inch"
): CollectedGridShapes {
  const lines: RenderGridLine[] = [];
  const boxes: RenderGridBox[] = [];

  for (const record of records) {
    const page = record.page !== undefined ? { page: record.page } : {};
    for (const entry of parseKeywordEntries(record.keywords)) {
      if (entry.kind !== "keyword" || entry.parameters === undefined) continue;
      if (entry.name === "LINE") {
        const shape = parsePrtfLine(entry.parameters, density, uom);
        if (shape) lines.push({ ...shape, sourceLine: record.sourceLine, ...page });
      } else if (entry.name === "BOX") {
        const shape = parsePrtfBox(entry.parameters, density, uom);
        if (shape) boxes.push({ ...shape, sourceLine: record.sourceLine, ...page });
      }
    }
  }

  return { lines, boxes };
}
