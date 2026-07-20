import { DDS_COLUMNS, ddsField, isDdsBlankLine, isDdsCommentLine } from "../ddsLayout";
import { keywordAreaOf } from "./ddsLogicalUnits";

/**
 * 表示装置ファイルの画面サイズ（`DSPSIZ` キーワード）を読む。
 *
 * 原典（`表示装置ファイルの DSPSIZ (画面サイズ) キーワード`）:
 * > DSPSIZ(*DSw [*DSx])
 * > DSPSIZ(lines positions[condition-name-1][lines positions[condition-name-2]])
 *
 * > このキーワードを**指定しなかった場合**には、表示装置ファイルは、
 * > **24 x 80 の画面**を備えた表示装置に対してのみオープンすることができます。
 *
 * > 行数と桁数で画面サイズを指定します（**指定できるのは、24 x 80、および 27 x 132 だけ**です）。
 *
 * 有効な画面サイズ（原典の表）:
 * | `*DS3` または 24 x 80  | 24 行 x 80 桁、合計 1920 桁 |
 * | `*DS4` または 27 x 132 | 27 行 x 132 桁、合計 3564 桁 |
 *
 * ■ ファイル・レベルなので論理単位からは読まない
 *   `DSPSIZ` は最初のレコード様式より前に書かれる。`toLogicalUnits` は
 *   レコードにも項目にも属さない先頭のキーワード行を捨てるので、
 *   ここでは**生の行**を先頭から最初のレコードまで走査する。
 */

export interface ScreenSize {
  readonly rows: number;
  readonly columns: number;
}

export interface ScreenSizeEntry {
  readonly size: ScreenSize;
  /** DSPSIZ に添えられた条件名（`*DS3` 等、またはユーザー定義名）。 */
  readonly conditionName?: string;
}

export interface ScreenSizes {
  /** 1 次画面サイズ。DSPSIZ 省略時は 24x80。 */
  readonly primary: ScreenSizeEntry;
  /** 2 次画面サイズ（指定があれば）。 */
  readonly secondary?: ScreenSizeEntry;
  /** DSPSIZ が書かれていたか。false なら既定の 24x80。 */
  readonly declared: boolean;
  /** DSPSIZ が書かれていた行（1 始まり）。 */
  readonly sourceLine?: number;
}

export interface ScreenSizeProblem {
  readonly message: string;
  /** 1 始まり。 */
  readonly sourceLine: number;
}

export interface ScreenSizeResult {
  readonly sizes: ScreenSizes;
  readonly problems: readonly ScreenSizeProblem[];
}

/** 原典で有効な画面サイズはこの 2 つだけ。 */
const DS3: ScreenSize = { rows: 24, columns: 80 };
const DS4: ScreenSize = { rows: 27, columns: 132 };

/** DSPSIZ 省略時（原典: 24 x 80 の画面に対してのみオープンできる）。 */
export const DEFAULT_SCREEN: ScreenSizeEntry = { size: DS3 };

const IBM_SIZE_NAMES: ReadonlyMap<string, ScreenSize> = new Map([
  ["*DS3", DS3],
  ["*DS4", DS4]
]);

function sameSize(a: ScreenSize, b: ScreenSize): boolean {
  return a.rows === b.rows && a.columns === b.columns;
}

function knownSize(rows: number, columns: number): ScreenSize | undefined {
  if (sameSize({ rows, columns }, DS3)) return DS3;
  if (sameSize({ rows, columns }, DS4)) return DS4;
  return undefined;
}

/**
 * ユーザー定義の画面サイズ条件名として妥当か。
 *
 * 原典:
 * > 定義する画面サイズ条件名は、**2 - 8 文字**でなければならず、
 * > また、**最初の文字はアスタリスク (*)** でなければなりません。
 */
export function isScreenSizeConditionName(token: string): boolean {
  return /^\*[A-Z0-9]{1,7}$/u.test(token.toUpperCase());
}

/**
 * IBM 提供の画面サイズ条件名（`*DS3` / `*DS4`）が指すサイズ。
 * ユーザー定義名は解決できないので undefined。
 */
export function screenSizeOfConditionName(name: string): ScreenSize | undefined {
  return IBM_SIZE_NAMES.get(name.toUpperCase());
}

/**
 * 条件付け欄に書かれた画面サイズ条件名が、指定のサイズを指しているか。
 *
 * **名前の文字列だけで比べてはいけない。** `DSPSIZ` を数値形式で書くと
 * 条件名が付かないが、そのときも IBM 提供名で条件付けできる。原典:
 * > ユーザー定義の画面サイズ条件名を指定しない場合には、IBM 提供の画面サイズ条件名を
 * > 使用してフィールドの位置を条件付ける必要があります。
 *
 * 名前で比べると、この形の項目が**黙って消える**。
 */
export function matchesScreenSize(name: string, entry: ScreenSizeEntry): boolean {
  const upper = name.toUpperCase();
  if (entry.conditionName !== undefined && entry.conditionName === upper) return true;

  // IBM 提供名はサイズに解決してから突き合わせる。
  const size = screenSizeOfConditionName(upper);
  return size !== undefined && sameSize(size, entry.size);
}

/** ファイル・レベル（最初のレコード様式より前）のキーワード欄を連結する。 */
function fileLevelKeywords(
  lines: readonly string[]
): { readonly text: string; readonly sourceLine: number } | undefined {
  let text = "";
  let sourceLine = 0;

  for (const [index, line] of lines.entries()) {
    if (isDdsCommentLine(line) || isDdsBlankLine(line)) continue;
    if (ddsField(line, DDS_COLUMNS.nameType).trim().toUpperCase() === "R") break;

    const keywords = keywordAreaOf(line);
    if (keywords.length === 0) continue;
    if (text.length === 0) sourceLine = index + 1;
    text = text.length === 0 ? keywords : `${text} ${keywords}`;
  }

  return text.length === 0 ? undefined : { text, sourceLine };
}

/** `DSPSIZ(...)` の括弧の中を取り出す。 */
function readDspsizArguments(
  keywords: string
): { readonly args: string; readonly offset: number } | undefined {
  const match = /\bDSPSIZ\s*\(([^)]*)\)/u.exec(keywords);
  if (!match) return undefined;
  return { args: match[1], offset: match.index };
}

export function resolveScreenSizes(lines: readonly string[]): ScreenSizeResult {
  const fileLevel = fileLevelKeywords(lines);
  const fallback: ScreenSizeResult = {
    sizes: { primary: DEFAULT_SCREEN, declared: false },
    problems: []
  };
  if (!fileLevel) return fallback;

  const found = readDspsizArguments(fileLevel.text);
  if (!found) return fallback;

  const sourceLine = fileLevel.sourceLine;
  const problems: ScreenSizeProblem[] = [];
  const entries: ScreenSizeEntry[] = [];
  const tokens = found.args.trim().split(/\s+/u).filter(token => token.length > 0);

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    const upper = token.toUpperCase();

    // 形式 1: IBM 提供の画面サイズ条件名（*DS3 / *DS4）
    const ibm = IBM_SIZE_NAMES.get(upper);
    if (ibm) {
      entries.push({ size: ibm, conditionName: upper });
      index += 1;
      continue;
    }

    // 形式 2: 行数 桁数 [条件名]
    const rows = Number(token);
    const columns = Number(tokens[index + 1]);
    if (!/^\d+$/u.test(token) || !/^\d+$/u.test(tokens[index + 1] ?? "")) {
      problems.push({
        message: `DSPSIZ の値 "${token}" が読めません（原典: *DS3 / *DS4 または 行数 桁数）`,
        sourceLine
      });
      index += 1;
      continue;
    }

    const size = knownSize(rows, columns);
    if (!size) {
      problems.push({
        message:
          `DSPSIZ の画面サイズ ${rows} x ${columns} は無効です` +
          "（原典: 指定できるのは 24 x 80 と 27 x 132 だけ）",
        sourceLine
      });
      index += 2;
      continue;
    }

    index += 2;
    const next = tokens[index];
    if (next !== undefined && next.startsWith("*")) {
      if (!isScreenSizeConditionName(next)) {
        problems.push({
          message:
            `画面サイズ条件名 "${next}" が無効です` +
            "（原典: 2 - 8 文字で、最初の文字は *）",
          sourceLine
        });
      }
      entries.push({ size, conditionName: next.toUpperCase() });
      index += 1;
    } else {
      entries.push({ size });
    }
  }

  if (entries.length === 0) {
    // 値そのものが不正だった場合は、その診断だけで足りる（同じことを 2 度言わない）。
    if (problems.length === 0) {
      problems.push({
        message: "DSPSIZ に画面サイズが指定されていません（既定の 24 x 80 で描画します）",
        sourceLine
      });
    }
    return { sizes: { primary: DEFAULT_SCREEN, declared: false, sourceLine }, problems };
  }

  if (entries.length > 2) {
    problems.push({
      message:
        `DSPSIZ の画面サイズが ${entries.length} 個あります` +
        "（原典: 最高 2 つ。先頭の 2 つを使います）",
      sourceLine
    });
  }

  const [primary, secondary] = entries;
  if (secondary && sameSize(primary.size, secondary.size)) {
    problems.push({
      message: "DSPSIZ に同じ画面サイズが 2 度指定されています（原典: 不可）",
      sourceLine
    });
  }

  return {
    sizes: { primary, secondary, declared: true, sourceLine },
    problems
  };
}
