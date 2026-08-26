/**
 * DDS のモデル。
 *
 * ## 設計の中核: すべての行が `raw` を持つ
 *
 * 解釈できた行も、できなかった行も、**生テキストを捨てない**。
 * シリアライズは `raw` の単なる連結にするため、「編集していない行はバイト不変」が
 * 実装の注意深さではなく**構造**で保証される（spec D2 / requirement AC2）。
 *
 * 解釈できない行は `opaque` として素通しする。**扱えない要素があることは許容するが、
 * 扱えない要素を壊すことは許容しない**（requirement の原則）。
 */

import type { SourceEncoding } from "../text/decode.js";

/** 改行コード。元ファイルのものを保持し、書き戻しで復元する。 */
export type Eol = "\r\n" | "\n";

/** DDS ソース 1 本ぶんのモデル。 */
export interface DdsDoc {
  /** 元ファイルの改行コード。 */
  readonly eol: Eol;
  /** UTF-8 BOM があったか。 */
  readonly bom: boolean;
  /**
   * 最終行の後に改行があったか。
   *
   * ここを保持しないと「編集していないのに末尾 1 バイトだけ差分が出る」という、
   * 最も気付きにくい形のバイト不変違反が起きる。
   */
  readonly finalNewline: boolean;
  /** 読み込み時に判定したエンコーディング。 */
  readonly encoding: SourceEncoding;
  /** ソース行の桁数（実機は 80 / 120 等）。書き戻しでこれを超えない。 */
  readonly lineWidth: number;
  /** 全行。順序はファイルどおり。 */
  readonly lines: readonly DdsLine[];
  /** レコード様式の索引。 */
  readonly records: readonly DdsRecord[];
}

/** 1 行。どの種別でも `raw` を必ず持つ。 */
export type DdsLine =
  | OpaqueLine
  | RecordLine
  | ItemLine;

/**
 * 解釈しない行。コメント・継続行・ファイルレベルのキーワード・未知の書式。
 *
 * **編集対象にはならないが、書き戻しでそのまま出力される。**
 */
export interface OpaqueLine {
  readonly kind: "opaque";
  readonly raw: string;
}

/** レコード様式の宣言行（17 桁目が `R`）。 */
export interface RecordLine {
  readonly kind: "record";
  readonly raw: string;
  readonly name: string;
}

/** フィールドまたは定数の行。 */
export interface ItemLine {
  readonly kind: "item";
  readonly raw: string;
  readonly item: DdsItem;
}

/** レコード様式。 */
export interface DdsRecord {
  readonly name: string;
  /** 宣言行の 0 始まり行番号。 */
  readonly lineIndex: number;
  /** 所属するアイテムの ID（出現順）。 */
  readonly itemIds: readonly string[];
}

/** 画面に出る要素（フィールドまたは定数）。 */
export interface DdsItem {
  /**
   * 安定 ID。`${record}#${ordinal}` の形。
   *
   * **ファイルには書かない**（モデル内の識別子）。`dds parse --json` の出力には含める。
   *
   * **構造を変えると振り直される。** ID は再パースのたびに出現順で採番されるので、
   * 追加・削除の後は同じ ID が別のアイテムを指しうる（04 `decisions.md` D3 / 07 review should-2）。
   * **ID を跨いで保持する側（GUI の選択状態・CLI の続けざまの操作）が、構造変更後に捨てる責任を持つ。**
   */
  readonly id: string;
  readonly kind: "field" | "constant";
  /** 所属するレコード様式名。レコード宣言より前に現れた場合は空文字。 */
  readonly record: string;
  /** この要素が書かれている 0 始まり行番号。 */
  readonly lineIndex: number;

  /** 名前（19-28 桁）。フィールドのみ。 */
  readonly name?: string;
  /** 定数のリテラル（機能欄の引用符の中身）。定数のみ。 */
  readonly text?: string;
  /** 長さ（30-34 桁）。 */
  readonly length?: number;
  /** データ型（35 桁）。 */
  readonly dataType?: string;
  /** 小数（36-37 桁）。 */
  readonly decimals?: string;
  /** 使用（38 桁）。 */
  readonly usage?: string;
  /** 画面上の行（39-41 桁）。 */
  readonly line?: number;
  /** 画面上の桁（42-44 桁）。 */
  readonly pos?: number;
  /** 条件（7-16 桁）。未解釈のまま保持する。 */
  readonly conditions?: string;
  /**
   * 機能キーワード欄（45-80 桁）の生テキスト。
   *
   * **walking skeleton では解釈しない。** 文字列のまま保持し、書き戻しでそのまま出す。
   * 構造化は L3（後続 work）の仕事で、そのとき型を差し替える。
   * 継続行（`+` / `-` で続く行）は `opaque` として別行に残るため、ここには含まれない。
   */
  readonly keywords: string;
}
