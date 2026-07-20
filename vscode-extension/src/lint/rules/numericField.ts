import type { ParameterDefinition } from "../../prompter/types";
import type { LintFinding, RuleContext } from "../types";

/**
 * 数値欄（右寄せ必須の欄）の検査。
 *
 * 対象は定義の `attributes.numericOnly` が立っている欄。この属性は
 * **原典の「右寄せ」という記述からのみ**立てられており（generate-dds-prompter.mjs）、
 * 実機でも左詰めは CPF7311 で作成できない。実機コンパイル確認済みのソースに
 * 当てて偽陽性が 0 件だったのもこの規則（research F3）。
 *
 * `characterSet: "upper"` は**使わない**。あちらは全欄にハードコードされていて
 * 原典由来ではなく、45-80 桁のキーワード欄にも付いているため、検査すると
 * `COLHDG('カナ名')` を含む正常な行を弾いてしまう。
 */

interface FieldValue {
  readonly parameter: ParameterDefinition;
  /** 桁範囲を切り出した生の値（前後の空白を含む）。 */
  readonly raw: string;
  readonly startColumn: number;
  readonly endColumn: number;
}

/** 定位置の欄を持つパラメータを、行から切り出す。 */
function* numericFields(context: RuleContext): Generator<FieldValue> {
  const parameters = context.definition?.parameters ?? [];
  for (const parameter of parameters) {
    if (!parameter.attributes?.numericOnly) continue;
    if (!parameter.sourceStart || !parameter.sourceLength) continue;

    const start = parameter.sourceStart - 1;
    const raw = context.line.slice(start, start + parameter.sourceLength);
    // 行が短くて欄が存在しない場合は指摘しない。
    if (raw.length === 0) continue;

    yield {
      parameter,
      raw,
      startColumn: parameter.sourceStart,
      endColumn: parameter.sourceStart + raw.length
    };
  }
}

/** 数値欄に数字以外が入っている。 */
export function numericFieldRule(context: RuleContext): readonly LintFinding[] {
  const findings: LintFinding[] = [];

  for (const field of numericFields(context)) {
    const value = field.raw.trim();
    // 空欄は指摘しない（必須かどうかは別の規則の担当で、既定では見ない）。
    if (value.length === 0) continue;
    if (/^\d+$/u.test(value)) continue;

    findings.push({
      ruleId: "numeric-field",
      severity: "error",
      message:
        `${field.parameter.description}は数値欄ですが ` +
        `${JSON.stringify(value)} が入っています。`,
      line: context.lineNumber,
      startColumn: field.startColumn,
      endColumn: field.endColumn,
      specKeyword: context.specKeyword,
      parameterName: field.parameter.name
    });
  }

  return findings;
}

/**
 * 数値欄が右寄せでない。
 *
 * severity を warning にしているのは、右寄せ必須の明示的な根拠が原典にあるのは
 * DDS の長さ欄（30-34 桁）であり、RPG 側の numericOnly 欄すべてに同じ強さの
 * 根拠を確認できていないため。既定の `--fail-on error` では CI を落とさない。
 */
export function numericAlignmentRule(context: RuleContext): readonly LintFinding[] {
  const findings: LintFinding[] = [];

  for (const field of numericFields(context)) {
    const value = field.raw.trim();
    if (value.length === 0) continue;
    // 数字でない時点で numeric-field が指摘するので、ここでは扱わない。
    if (!/^\d+$/u.test(value)) continue;
    // 行末で欄が切れている場合は右寄せかどうか判定できない。
    if (field.raw.length < (field.parameter.sourceLength ?? 0)) continue;

    const rightAligned = field.raw === value.padStart(field.raw.length);
    if (rightAligned) continue;

    findings.push({
      ruleId: "numeric-alignment",
      severity: "warning",
      message:
        `${field.parameter.description}は右寄せで書きます` +
        `（実機では左詰めが CPF7311 になります）。`,
      line: context.lineNumber,
      startColumn: field.startColumn,
      endColumn: field.endColumn,
      specKeyword: context.specKeyword,
      parameterName: field.parameter.name
    });
  }

  return findings;
}
