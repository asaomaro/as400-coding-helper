import { indexExceedingWidth, printWidth } from "../../core/dbcs";
import type { LintFinding, RuleContext } from "../types";

/**
 * 行長の検査。
 *
 * **80 桁超過は指摘しない。** 原典は全仕様書で
 *   「仕様書の注記以外の部分は 7 から 80 桁目です。…
 *     仕様書の注記部分は **81 から 100 桁目** です。」
 * と規定しており（ILE RPG の F/D/C 仕様書レイアウト）、DDS の SEU 書式行も
 * 81-100 桁の目盛り（commentRuler）を持つ。80 桁で切ると正しいソースを弾く。
 *
 * 上限は 100 桁。ここを超えた分はどの仕様書にも居場所が無い。
 *
 * ## 桁は**実機の桁**で数える（JS の文字数ではない）
 *
 * ローカルのソースに SO/SI は無いが、実機のメンバーでは DBCS の連なりの前後に
 * 1 桁ずつ入り、全角 1 文字は 2 桁を占める（`printWidth`）。
 * **JS の文字数で数えると大幅に足りない**——実機で確かめた（IBM i 7.3。
 * `.aidev/works/20260828-dds-line-width-columns/verify/probe-line-truncation.mjs`）:
 * 全角 30 文字の定数を持つ行は **JS では 76 文字**だが、メンバーに入れると
 * **切り捨てられて読み戻すと 71 文字**になっていた。指摘が出ないまま欠ける。
 */

/**
 * 上限の既定。原典の「注記部分は 81 から 100 桁目」に対応する桁数で、
 * レコード長 112 のソース物理ファイル（実機の 86.7%）のデータ桁数と一致する。
 */
export const DEFAULT_MAX_COLUMN = 100;

/**
 * 設定できる桁数の範囲。
 *
 * 上端は実機で観測したソース物理ファイルの最大レコード長 32766 から、先頭に付く
 * 行番号 6 バイト（`SRCSEQ`）＋ 日付 6 バイト（`SRCDAT`）を引いた値。
 *
 * **下端を 80 にしていない。** レコード長 13 / 15 / 20 / 50 / 72 / 80 のソース物理
 * ファイルは実在し、そこに固定長ソースを入れれば実際に切り捨てられる。指摘が出るのが
 * 正しく、80 未満を禁じると**正しい設定ができなくなる**。
 */
export const MIN_MAX_COLUMN = 1;
export const MAX_MAX_COLUMN = 32754;

/**
 * 設定値を桁上限に解決する。整数でない・範囲外なら既定に戻す。
 *
 * **黙って既定に戻すのは設定経由の値だけ**（設定 UI にエラーを出す手立てが無く、
 * 検査が黙って止まるのが最悪なため）。CLI は明示的に渡した値なので呼び出し側で弾く。
 */
export function resolveMaxColumn(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return DEFAULT_MAX_COLUMN;
  if (value < MIN_MAX_COLUMN || value > MAX_MAX_COLUMN) return DEFAULT_MAX_COLUMN;
  return value;
}

/**
 * 上限に応じた欄の内訳。**原典を超えて言い切らない**。
 *
 * 原典が規定するのは「仕様書は 7-80 桁目、注記は 81-100 桁目」までで、
 * 101 桁目以降が何かは書かれていない。したがって上限が 100 を超えても
 * 注記域は 100 桁までとしか言わない。逆に上限が 80 以下のときは
 * **注記域が存在しない**ので、あるかのように案内しない。
 */
function describeColumns(maxColumn: number): string {
  if (maxColumn >= DEFAULT_MAX_COLUMN) {
    return `（1-80 桁が仕様書、81-${DEFAULT_MAX_COLUMN} 桁が注記域）`;
  }
  if (maxColumn > 80) {
    return `（1-80 桁が仕様書、81-${maxColumn} 桁が注記域）`;
  }
  return `（1-${maxColumn} 桁が仕様書。注記域は入りません）`;
}

export function lineLengthRule(context: RuleContext): readonly LintFinding[] {
  const maxColumn = context.maxColumn;
  const columns = printWidth(context.line);
  if (columns <= maxColumn) {
    return [];
  }

  // **下線の位置は JS の添字**（エディタの列は文字数で数える）。
  // 桁とは別物なので、溢れ始める文字を別に求める。
  const from = indexExceedingWidth(context.line, maxColumn) ?? context.line.length;

  return [
    {
      ruleId: "line-length",
      severity: "error",
      message:
        `行が ${columns} 桁あります` +
        (columns === context.line.length ? "" : `（全角の分を含む。文字数は ${context.line.length}）`) +
        `。固定長ソースは ${maxColumn} 桁までです` +
        `${describeColumns(maxColumn)}。`,
      line: context.lineNumber,
      startColumn: from + 1,
      endColumn: context.line.length + 1,
      specKeyword: context.specKeyword
    }
  ];
}
