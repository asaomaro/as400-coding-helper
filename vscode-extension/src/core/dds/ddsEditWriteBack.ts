import { DDS_COLUMNS, ddsReplaceField } from "../ddsLayout";
import { DDS_CONDITIONING } from "./ddsLogicalUnits";
import { formatScreenSizeArea } from "./ddsConditionWriteBack";
import { writeBackPosition } from "./ddsPositionWriteBack";
import { parseKeywordEntries } from "./ddsKeywords";
import { DDS_KEYWORD_AREA_START } from "./ddsLogicalUnits";
import { DDS_POSITION_COLUMN, DDS_POSITION_ROW } from "./ddsPositionColumns";

/**
 * 位置欄**以外**の書き戻しと、新しい項目行の組み立て。
 *
 * **vscode を import しない**（文字列 → 文字列）。位置欄の書き戻しは
 * `ddsPositionWriteBack.ts` にあり、**同じ流儀**に揃えてある:
 *
 * - 指定した桁の範囲だけを差し替え、**他の桁には触れない**（`ddsReplaceField`）。
 * - 数値欄は**右詰め**。原典（`桁数 (30 から 34 桁目)`）:
 *   > 桁数は、右寄せで指定しなければなりません。
 * - 書き換えで生まれた**行末の空白は落とす**（元の行と同じ姿に保つ）。
 */

/** DDS の行の先頭（1-6 桁）。6 桁目の `A` が仕様の種別。 */
const LINE_PREFIX = "     A";

/** 長さ欄（30-34 桁）だけを書き換えた行を返す。 */
export function writeBackLength(line: string, length: number): string {
  return ddsReplaceField(
    line,
    DDS_COLUMNS.length,
    formatNumber(length, columnWidth(DDS_COLUMNS.length))
  ).trimEnd();
}

/**
 * キーワード欄の幅（45-80 桁 ＝ 36 桁）。
 *
 * **81 桁目以降は DDS が読まない**（実機で確認。80 桁を超えた行は
 * `CPD7508「閉じ引用符が無い」`で落ちる）。ここに収まらないものは次の行へ折る。
 */
export const KEYWORD_AREA_WIDTH = 80 - DDS_KEYWORD_AREA_START + 1;

/**
 * キーワード欄のテキストを、1 行に収まる塊へ折る。
 *
 * ## 切れ目で折るのを第一にする
 *
 * キーワードの区切りで次の行へ置けるなら、**継続記号は使わない**——
 * `toLogicalUnits` が「キーワードだけの行」を**空白 1 つ**で連結するので、読み直せば同じになる。
 * `-` を使うのは**1 つのキーワードが 36 桁に収まらないとき**だけ。
 * そうしないと、普通の並びが `-` だらけになって読めなくなる。
 *
 * ## `+` は書き出さない
 *
 * 読む側は `+` も解釈するが（実機の規則）、書くのは `-` だけにする。
 * `+` は**継続行の先頭の空白を捨てる**ので、空白を含む値で再現性が落ちる。
 *
 * 返り値の 1 つ目が代表行の欄、2 つ目以降が継続行の欄。空なら空配列。
 */
export function foldKeywordArea(keywords: string): readonly string[] {
  const flat = keywords.replace(/[\r\n]+/gu, " ").trim();
  if (flat.length === 0) return [];

  const chunks: string[] = [];
  let current = "";

  const flush = (): void => {
    if (current.length > 0) chunks.push(current);
    current = "";
  };

  for (const entry of parseKeywordEntries(flat)) {
    const candidate = current.length === 0 ? entry.raw : `${current} ${entry.raw}`;
    if (candidate.length <= KEYWORD_AREA_WIDTH) {
      current = candidate;
      continue;
    }

    // 切れ目で折れるなら折る（継続記号は要らない）。
    flush();
    if (entry.raw.length <= KEYWORD_AREA_WIDTH) {
      current = entry.raw;
      continue;
    }

    // 1 つのキーワードが 36 桁を超える。ここだけ `-` で切る。
    let rest = entry.raw;
    while (rest.length > KEYWORD_AREA_WIDTH) {
      chunks.push(`${rest.slice(0, KEYWORD_AREA_WIDTH - 1)}-`);
      rest = rest.slice(KEYWORD_AREA_WIDTH - 1);
    }
    current = rest;
  }

  flush();
  return chunks;
}

/**
 * 継続行（キーワードだけの行）を組み立てる。**1-44 桁は空白**。
 *
 * 位置や名前を写さない——写すと同じ項目が 2 つあることになる。
 */
export function buildKeywordLine(area: string): string {
  return writeBackKeywordArea(LINE_PREFIX, area);
}

/** 定位置欄に書ける属性。**与えた欄だけ**を書き換える。 */
export interface ItemAttributePatch {
  readonly name?: string;
  readonly length?: number;
  readonly dataType?: string;
  readonly decimals?: number;
  readonly usage?: string;
}

/**
 * 定位置欄の属性を書き換えた行を返す。**与えた欄だけ**に触る。
 *
 * 名前・型・使用は**大文字に正規化**する（実ソースはすべて大文字で、
 * 小文字のまま書くと実機のコンパイラの扱いが版に依存する）。
 * 数値欄は右詰め（原典: 桁数は右寄せで指定しなければなりません）。
 */
export function writeBackAttributes(
  line: string,
  attributes: ItemAttributePatch
): string {
  let next = line;

  if (attributes.name !== undefined) {
    next = ddsReplaceField(next, DDS_COLUMNS.name, attributes.name.toUpperCase());
  }
  if (attributes.length !== undefined) {
    next = ddsReplaceField(
      next,
      DDS_COLUMNS.length,
      formatNumber(attributes.length, columnWidth(DDS_COLUMNS.length))
    );
  }
  if (attributes.dataType !== undefined) {
    next = ddsReplaceField(
      next,
      DDS_COLUMNS.dataType,
      attributes.dataType.toUpperCase()
    );
  }
  if (attributes.decimals !== undefined) {
    next = ddsReplaceField(
      next,
      DDS_COLUMNS.decimals,
      formatNumber(attributes.decimals, columnWidth(DDS_COLUMNS.decimals))
    );
  }
  if (attributes.usage !== undefined) {
    next = ddsReplaceField(next, DDS_COLUMNS.usage, attributes.usage.toUpperCase());
  }

  return next.trimEnd();
}

/**
 * キーワード欄（45 桁〜）を差し替えた行を返す。
 *
 * 定数のリテラルを変えるときに使う。**欄の中身は呼び出し側が組む**
 * （このファイルは桁の面倒だけを見る）。
 */
export function writeBackKeywordArea(line: string, keywords: string): string {
  return (line.slice(0, DDS_KEYWORD_AREA_START - 1).padEnd(DDS_KEYWORD_AREA_START - 1, " ") +
    keywords).trimEnd();
}

/** 追加する項目の指定。桁の意味は `DDS_COLUMNS` に従う。 */
export interface NewDspfItem {
  readonly kind: "field" | "constant";
  /** 19-28 桁。フィールドのみ。 */
  readonly name?: string;
  /** 定数のリテラル。**引用符は付けずに渡す**（この関数が付ける）。 */
  readonly text?: string;
  /** 30-34 桁。フィールドのみ。 */
  readonly length?: number;
  /** 35 桁。 */
  readonly dataType?: string;
  /** 36-37 桁。 */
  readonly decimals?: number;
  /** 38 桁。 */
  readonly usage?: string;
  /** 39-41 桁。1 始まり。 */
  readonly row: number;
  /** 42-44 桁。1 始まり。 */
  readonly column: number;
}

/**
 * 新しい項目の行を組み立てる。
 *
 * **定数のリテラルはキーワード欄（45 桁〜）に置く**（実ソースの書き方。`docs/src/CUSTMNT.dspf`）。
 * リテラル中の `'` は原典の書き方に合わせて `''` に重ねる（`readConstant` がこれを戻す）。
 *
 * **SO/SI は書かない。** DBCS はソースには生の全角のまま置き、実機への転送時に挿入される。
 */
export function buildItemLine(item: NewDspfItem): string {
  let line = LINE_PREFIX;

  if (item.kind === "field") {
    line = ddsReplaceField(line, DDS_COLUMNS.name, (item.name ?? "").toUpperCase());
    if (item.length !== undefined) {
      line = ddsReplaceField(
        line,
        DDS_COLUMNS.length,
        formatNumber(item.length, columnWidth(DDS_COLUMNS.length))
      );
    }
    if (item.dataType !== undefined) {
      line = ddsReplaceField(line, DDS_COLUMNS.dataType, item.dataType.toUpperCase());
    }
    if (item.decimals !== undefined) {
      line = ddsReplaceField(
        line,
        DDS_COLUMNS.decimals,
        formatNumber(item.decimals, columnWidth(DDS_COLUMNS.decimals))
      );
    }
    if (item.usage !== undefined) {
      line = ddsReplaceField(line, DDS_COLUMNS.usage, item.usage.toUpperCase());
    }
  }

  line = ddsReplaceField(
    line,
    DDS_POSITION_ROW,
    formatNumber(item.row, columnWidth(DDS_POSITION_ROW))
  );
  line = ddsReplaceField(
    line,
    DDS_POSITION_COLUMN,
    formatNumber(item.column, columnWidth(DDS_POSITION_COLUMN))
  );

  if (item.kind === "constant") {
    line = line.padEnd(DDS_KEYWORD_AREA_START - 1, " ") + quoteLiteral(item.text ?? "");
  }

  return line.trimEnd();
}

/** リテラルを引用符でくるむ。中の `'` は `''` に重ねる。 */
export function quoteLiteral(text: string): string {
  return `'${text.replace(/'/gu, "''")}'`;
}

function columnWidth([start, end]: readonly [number, number]): number {
  return end - start + 1;
}

/** 数値欄は右詰め。桁に収まらない値は呼び出し側が検査する前提。 */
function formatNumber(value: number, width: number): string {
  return String(Math.trunc(value)).padStart(width, " ");
}

/**
 * **位置の上書き行**（2 次画面サイズでの位置）を 1 本作る。
 *
 * 形は実機に判定させた（IBM i 7.3 / `CRTDSPF`。原典に規定が無い。
 * `.aidev/works/20260828-dds-secondary-edit/verify/probe-override-placement.mjs`）:
 * **画面サイズ条件名と位置だけ**を持つ。長さ欄を足すと通らない (PA)、
 * 条件付け欄に標識を混ぜても通らない (Q3/Q7)。
 *
 * だから `buildItemLine` と違い、名前・長さ・データ型・用途・キーワードを**受け取らない**
 * ——受け取れる形にすると「書いたらどうなるか」を考え続けることになる。
 */
export function buildAlternatePositionLine(
  name: string,
  row: number,
  column: number
): string {
  return writeBackPosition({
    line: ddsReplaceField(LINE_PREFIX, DDS_CONDITIONING, formatScreenSizeArea(name)),
    row,
    column
  }).trimEnd();
}
