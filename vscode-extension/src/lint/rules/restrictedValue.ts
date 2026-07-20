import type { LintFinding, RuleContext } from "../types";

/**
 * 定義済み値以外の値。**既定では無効**（`rules/index.ts` の enabledByDefault）。
 *
 * 有効にしても **`attributes.restricted === true` の欄だけ**を見る。
 * これは types.ts の規約そのもので、「restricted が false のとき options は
 * 候補であって制限ではない」。DDS / RPG の定義は restricted を設定していないので、
 * 有効化しても現状は 1 件も検出しない —— これは意図した安全側の挙動で、
 * 値集合の修復とセットで初めて機能する。
 *
 * 修復が要る理由（research.md F1。いずれも実測で確認済み）:
 *   - 原典は有効値を列挙した直後の「注」で DBCS のデータ・タイプ
 *     （J / E / O / G）を足しており、生成器がその注を読んでいない。
 *   - 表示装置の 38 桁目は先頭項目が「ブランクまたは 0」で、1 文字の値を拾う
 *     正規表現に合わずブランクも 0 も落ちている。
 *   - 実機が受けるのに原典の一覧に無い値もある（CUSTMNT.dspf の 38 桁 "O"）。
 *
 * 空欄は指摘しない。未入力かどうかは required-field の担当。
 */
export function restrictedValueRule(context: RuleContext): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  const parameters = context.definition?.parameters ?? [];

  for (const parameter of parameters) {
    // 列挙＝制限とは限らない。制限だと明示された欄だけを見る。
    if (parameter.attributes?.restricted !== true) continue;
    if (!parameter.options?.length) continue;
    if (!parameter.sourceStart || !parameter.sourceLength) continue;

    const start = parameter.sourceStart - 1;
    const value = context.line
      .slice(start, start + parameter.sourceLength)
      .trim();
    if (value.length === 0) continue;

    const allowed = parameter.options.map(option => option.value);
    if (allowed.includes(value)) continue;

    findings.push({
      ruleId: "restricted-value",
      severity: "error",
      message:
        `${parameter.description}に ${JSON.stringify(value)} は指定できません` +
        `（${allowed.filter(v => v.length > 0).join(" / ")}）。`,
      line: context.lineNumber,
      startColumn: parameter.sourceStart,
      endColumn: parameter.sourceStart + parameter.sourceLength,
      specKeyword: context.specKeyword,
      parameterName: parameter.name
    });
  }

  return findings;
}
