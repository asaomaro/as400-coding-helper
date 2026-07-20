import type { LintFinding, RuleContext } from "../types";

/**
 * 必須欄の未入力。**既定では無効**（`rules/index.ts` の enabledByDefault）。
 *
 * 有効にすると実機コンパイル確認済みでないソースを含め偽陽性が出ることが
 * 実測で分かっている（research.md F2）。枠だけ置いてあるのは、材料が揃ったときに
 * ここを直せば済むようにするため。
 *
 * 有効化しても成立しない理由は 2 つ:
 *   - DDS は generate-dds-prompter.mjs が `required: false` をハードコードしており、
 *     原典由来の必須情報が定義に入っていない。
 *   - 定義の `required` は「プロンプターの入力欄として必須か」であって
 *     「その行に必ず書かれているか」ではない。継続記入行（7-16 桁が空の F/D 仕様）や
 *     オペランドを取らない命令（ENDIF / SELECT / OTHER）で必ず空になる。
 *     継続記入行は前処理で除外済みだが、命令ごとの差は定義側にしか書けない。
 */
export function requiredFieldRule(context: RuleContext): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  const parameters = context.definition?.parameters ?? [];

  for (const parameter of parameters) {
    if (!parameter.required) continue;
    if (!parameter.sourceStart || !parameter.sourceLength) continue;

    const start = parameter.sourceStart - 1;
    const raw = context.line.slice(start, start + parameter.sourceLength);
    if (raw.trim().length > 0) continue;

    findings.push({
      ruleId: "required-field",
      severity: "error",
      message: `${parameter.description}は必須です。`,
      line: context.lineNumber,
      startColumn: parameter.sourceStart,
      endColumn: parameter.sourceStart + parameter.sourceLength,
      specKeyword: context.specKeyword,
      parameterName: parameter.name
    });
  }

  return findings;
}
