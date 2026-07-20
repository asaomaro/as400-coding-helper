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
 */

const MAX_COLUMN = 100;

export function lineLengthRule(context: RuleContext): readonly LintFinding[] {
  if (context.line.length <= MAX_COLUMN) {
    return [];
  }

  return [
    {
      ruleId: "line-length",
      severity: "error",
      message:
        `行が ${context.line.length} 桁あります。` +
        `固定長ソースは ${MAX_COLUMN} 桁までです` +
        `（1-80 桁が仕様書、81-100 桁が注記域）。`,
      line: context.lineNumber,
      startColumn: MAX_COLUMN + 1,
      endColumn: context.line.length + 1,
      specKeyword: context.specKeyword
    }
  ];
}
