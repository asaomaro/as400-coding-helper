import type { LintFinding, Rule, RuleId, Severity } from "../types";
import { lineLengthRule } from "./lineLength";
import { numericAlignmentRule, numericFieldRule } from "./numericField";
import { requiredFieldRule } from "./requiredField";
import { restrictedValueRule } from "./restrictedValue";

/**
 * 規則の一覧と既定の有効／無効。
 *
 * 既定 ON にしてよいのは「原典で裏が取れ、実機コンパイル確認済みのソースに
 * 当てて偽陽性が 0 件だったもの」だけ。4 規則をそのまま当てると検証済みの
 * ソースに 30 件の指摘が出ることを実測してある（research.md）。
 */

export interface RuleSpec {
  readonly id: RuleId;
  readonly rule: Rule;
  readonly enabledByDefault: boolean;
  readonly severity: Severity;
  /** SARIF の規則説明に出す一文。 */
  readonly description: string;
  /** 継続記入行にも適用するか（定位置の欄を見ない規則だけ true）。 */
  readonly appliesToContinuation: boolean;
}

export const RULE_SPECS: readonly RuleSpec[] = [
  {
    id: "line-length",
    rule: lineLengthRule,
    enabledByDefault: true,
    severity: "error",
    description:
      "行が 100 桁を超えていないか。81-100 桁は原典が注記域と規定しているため、" +
      "80 桁超過は指摘しない。",
    appliesToContinuation: true
  },
  {
    id: "numeric-field",
    rule: numericFieldRule,
    enabledByDefault: true,
    severity: "error",
    description:
      "右寄せ必須の数値欄に数字以外が入っていないか（実機では CPF7311）。",
    appliesToContinuation: false
  },
  {
    id: "numeric-alignment",
    rule: numericAlignmentRule,
    enabledByDefault: true,
    severity: "warning",
    description: "数値欄が右寄せで書かれているか。",
    appliesToContinuation: false
  },
  {
    id: "required-field",
    rule: requiredFieldRule,
    enabledByDefault: false,
    severity: "error",
    description:
      "必須欄が空でないか。**既定で無効**。DDS は定義の required が生成時に " +
      "false 固定で材料が無く、RPG は継続記入行やオペランドを取らない命令で " +
      "偽陽性が出る（実測 64 件）。",
    appliesToContinuation: false
  },
  {
    id: "restricted-value",
    rule: restrictedValueRule,
    enabledByDefault: false,
    severity: "error",
    description:
      "定義済み値以外が入っていないか。**既定で無効**。値集合が原典の注記を " +
      "取りこぼしており（DBCS のデータ・タイプ）、原典自体も実機より狭い箇所がある。",
    appliesToContinuation: false
  }
];

const BY_ID = new Map(RULE_SPECS.map(spec => [spec.id, spec]));

export function ruleSpec(id: RuleId): RuleSpec | undefined {
  return BY_ID.get(id);
}

export function defaultEnabledRules(): RuleId[] {
  return RULE_SPECS.filter(spec => spec.enabledByDefault).map(spec => spec.id);
}

export type { LintFinding };
