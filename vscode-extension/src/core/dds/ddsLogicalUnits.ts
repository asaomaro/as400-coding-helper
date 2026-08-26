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
  /**
   * この単位に属するソース行（1 始まり・昇順）。**先行する条件行・代表行・キーワード継続行**。
   *
   * **削除の単位はこれ**——代表行だけ消すとキーワード継続行が孤児として残る。
   * 注記行・空行はどの単位にも属さないので**含まれない**（間に挟まっていても消さない）。
   * したがって連続とは限らない。
   */
  readonly sourceLines: readonly number[];
}

/** キーワード欄（45 桁以降）を取り出す。 */
export function keywordAreaOf(line: string): string {
  return line.slice(DDS_KEYWORD_AREA_START - 1).trimEnd();
}

/** 定数のリテラル（キーワード欄の先頭の `'…'`）。読む側と書く側で同じ形を使う。 */
const LEADING_CONSTANT = /^'((?:[^']|'')*)'/u;

/** 定数（キーワード欄の `'…'`）を取り出す。 */
export function readConstant(keywords: string): string | undefined {
  const match = LEADING_CONSTANT.exec(keywords.trim());
  return match ? match[1].replace(/''/gu, "'") : undefined;
}

/**
 * キーワード欄の**先頭のリテラルだけ**を差し替える。定数でなければ `undefined`。
 *
 * **後ろに続くキーワードは触らない。** DDS は `2'見出し'DSPATR(HI)` のように
 * リテラルの後ろにキーワードを書けるので、欄ごと置き換えると**キーワードが消える**。
 * 読む側（`readConstant`）と同じ正規表現を使い、規則を 2 か所に持たない。
 *
 * リテラル中の `'` は原典の書き方に合わせて `''` に重ねる（`readConstant` がこれを戻す）。
 */
export function replaceLeadingConstant(
  keywords: string,
  text: string
): string | undefined {
  const match = LEADING_CONSTANT.exec(keywords.trim());
  if (!match) {
    return undefined;
  }
  const leading = keywords.length - keywords.trimStart().length;
  const quoted = `'${text.replace(/'/gu, "''")}'`;
  return (
    keywords.slice(0, leading) + quoted + keywords.trim().slice(match[0].length)
  );
}

/**
 * 項目の種別。**定数（固定情報）か、名前つきフィールドか。**
 *
 * 原典（`桁数 (30 - 34 桁目)`）は固定情報に桁数を書かないと定めており、
 * 実装上も「名前欄が空で、キーワード欄がリテラルで始まる」ものが定数になる。
 * **描画（`dspfLayout`）と編集（`ddsEdit`）が同じ判定を使う**ために、規則はここに置く。
 */
export function unitItemKind(unit: LogicalUnit): "field" | "constant" {
  const name = ddsName(unit.line).trim();
  return name.length === 0 && readConstant(unit.keywords) !== undefined
    ? "constant"
    : "field";
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
  let pendingConditioningLines: number[] = [];

  const push = (kind: "record" | "item", line: string, index: number): void => {
    units.push({
      kind,
      line,
      sourceLine: index + 1,
      keywords: keywordAreaOf(line),
      conditioningLines: [...pendingConditioning, line],
      sourceLines: [...pendingConditioningLines, index + 1]
    });
    pendingConditioning = [];
    pendingConditioningLines = [];
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
      pendingConditioningLines.push(index + 1);
      return;
    }

    // キーワードだけの行。直前の単位に足す。
    // 直前が無ければファイル・レベルのキーワード（REF など）で、配置に関係しない。
    const previous = units[units.length - 1];
    if (!previous) return;
    units[units.length - 1] = {
      ...previous,
      keywords: `${previous.keywords} ${keywordArea}`.trim(),
      sourceLines: [...previous.sourceLines, index + 1]
    };
  });

  return units;
}
