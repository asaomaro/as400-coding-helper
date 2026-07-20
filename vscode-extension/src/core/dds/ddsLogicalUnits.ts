import {
  DDS_COLUMNS,
  ddsField,
  ddsName,
  isDdsBlankLine,
  isDdsCommentLine
} from "../ddsLayout";

/**
 * DDS の行を「論理単位」にまとめる。**印刷装置・表示装置に共通**。
 *
 * DDS では**キーワードだけの行は直前のレコード／項目の続き**なので、
 * 行を 1 本ずつ処理すると桁送りやキーワードの持ち主を取り違える。
 *
 * 実際に `CUSTRPT.prtf` で踏んだ:
 * ```
 *   A          R HEADING                   SKIPB(1)
 *   A                                      SPACEA(2)   ← HEADING のキーワード
 *   A                                    30'顧客一覧表'
 * ```
 * 2 行目を独立した行として扱うと、見出しと明細が同じ行に重なる。
 *
 * この性質は PRTF 固有ではないので、DSPF からも同じものを使う。
 *
 * ■ 条件付けの行は「次」に付く（表示装置ファイルで効く）
 *   原典（`条件付け (7 - 16 桁目)`）:
 *   > フィールドについて条件を設定する際には、そのフィールド名 (または固定情報) と
 *   > **最後の (または唯一の) 標識は同じ行に指定**しなければなりません。
 *
 *   つまり条件が複数行に分かれる場合、**先行する行が条件の続き**で、項目は最後の行にある。
 *   キーワードの継続行が「直前に付く」のと**向きが逆**なので、両者を判別する:
 *   キーワード欄が空で条件付け欄に何か書いてあれば、**次の単位への前置き**とみなす。
 *
 *   なお PRTF ではこの判別は結果を変えない（キーワード欄が空の行は、
 *   直前に連結しても空文字を足すだけで `keywords` が変わらないため）。
 */

/**
 * キーワード欄の開始桁（45）。位置欄の直後から始まる。
 *
 * 桁の基準は `DDS_COLUMNS` の 1 か所だけに置きたいので、数値を直接書かず導出する。
 */
export const DDS_KEYWORD_AREA_START = DDS_COLUMNS.position[1] + 1;

/** 条件付け欄（7-16 桁）。原典の表示装置ファイルの区切りに合わせる。 */
export const DDS_CONDITIONING: readonly [number, number] = [7, 16];

export interface LogicalUnit {
  readonly kind: "record" | "item";
  /** 単位の代表行（項目の桁を読む行）。 */
  readonly line: string;
  /** 1 始まり。 */
  readonly sourceLine: number;
  /** 代表行＋キーワード継続行のキーワード欄を連結したもの。 */
  readonly keywords: string;
  /**
   * 条件付けを読むための行群（先行する条件行 → 代表行 の順）。
   *
   * 条件付け欄は複数行にまたがるため、代表行だけでは条件を読めない。
   */
  readonly conditioningLines: readonly string[];
}

/** キーワード欄（45 桁以降）を取り出す。 */
export function keywordAreaOf(line: string): string {
  return line.slice(DDS_KEYWORD_AREA_START - 1).trimEnd();
}

/** 定数（キーワード欄の `'…'`）を取り出す。 */
export function readConstant(keywords: string): string | undefined {
  const match = /^'((?:[^']|'')*)'/u.exec(keywords.trim());
  return match ? match[1].replace(/''/gu, "'") : undefined;
}

/** 桁欄の数値を読む。空・数字以外は undefined。 */
export function readNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  if (!/^\d+$/u.test(trimmed)) return undefined;
  return Number(trimmed);
}

/** 条件付け欄（7-16 桁）の生の文字列。 */
export function conditioningAreaOf(line: string): string {
  const [start, end] = DDS_CONDITIONING;
  return line.slice(start - 1, end);
}

export function toLogicalUnits(lines: readonly string[]): LogicalUnit[] {
  const units: LogicalUnit[] = [];
  /** まだ単位に属さない、先行する条件付けの行。 */
  let pendingConditioning: string[] = [];

  const push = (kind: "record" | "item", line: string, index: number): void => {
    units.push({
      kind,
      line,
      sourceLine: index + 1,
      keywords: keywordAreaOf(line),
      conditioningLines: [...pendingConditioning, line]
    });
    pendingConditioning = [];
  };

  lines.forEach((line, index) => {
    if (isDdsCommentLine(line) || isDdsBlankLine(line)) return;

    const nameType = ddsField(line, DDS_COLUMNS.nameType).trim().toUpperCase();
    const name = ddsName(line);
    const keywordArea = keywordAreaOf(line);
    const constant = readConstant(keywordArea);

    if (nameType === "R") {
      push("record", line, index);
      return;
    }

    if (name.length > 0 || constant !== undefined) {
      push("item", line, index);
      return;
    }

    // キーワード欄が空で条件付けだけ書かれている行は、**次の単位への前置き**。
    if (keywordArea.length === 0 && conditioningAreaOf(line).trim().length > 0) {
      pendingConditioning.push(line);
      return;
    }

    // キーワードだけの行。直前の単位に足す。
    // 直前が無ければファイル・レベルのキーワード（REF など）で、配置に関係しない。
    const previous = units[units.length - 1];
    if (!previous) return;
    units[units.length - 1] = {
      ...previous,
      keywords: `${previous.keywords} ${keywordArea}`.trim()
    };
  });

  return units;
}
