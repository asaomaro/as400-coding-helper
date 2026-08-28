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

const MAX_COLUMN = 100;

export function lineLengthRule(context: RuleContext): readonly LintFinding[] {
  const columns = printWidth(context.line);
  if (columns <= MAX_COLUMN) {
    return [];
  }

  // **下線の位置は JS の添字**（エディタの列は文字数で数える）。
  // 桁とは別物なので、溢れ始める文字を別に求める。
  const from = indexExceedingWidth(context.line, MAX_COLUMN) ?? context.line.length;

  return [
    {
      ruleId: "line-length",
      severity: "error",
      message:
        `行が ${columns} 桁あります` +
        (columns === context.line.length ? "" : `（全角の分を含む。文字数は ${context.line.length}）`) +
        `。固定長ソースは ${MAX_COLUMN} 桁までです` +
        `（1-80 桁が仕様書、81-100 桁が注記域）。`,
      line: context.lineNumber,
      startColumn: from + 1,
      endColumn: context.line.length + 1,
      specKeyword: context.specKeyword
    }
  ];
}
