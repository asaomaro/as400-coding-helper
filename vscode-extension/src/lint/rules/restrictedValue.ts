import type { LintFinding, RuleContext } from "../types";

/**
 * 定義済み値以外の値。**既定で有効**（`rules/index.ts` の `enabledByDefault: true`）。
 *
 * 見るのは **`attributes.restricted === true` の欄だけ**。これは types.ts の規約
 * そのもので、「restricted が false のとき options は候補であって制限ではない」。
 *
 * **印が付くのは、実機で全空間（1 文字なら 37 通り）を試して受理集合が定義と
 * 完全一致した欄だけ。** いまは DDS の 7 欄——物理/論理の 17・35・38 桁、
 * 表示装置の 17・35・38 桁、印刷装置の 35 桁
 * （`docs/origin/generate-dds-prompter.mjs` の `PROVEN_COMPLETE` が単一の真実源）。
 *
 * **確かめずに印を付けると、正しいソースを弾く。** 実例:
 *   - 印刷装置 35 桁は、原典の**一覧の直後の「注」**にある `O` / `G` を
 *     生成器が読めておらず、足りない集合で咎めるところだった。
 *   - 物理/論理 38 桁は**文脈で値が変わる**（物理 = ブランク/B、単純論理 = ＋I、
 *     結合論理 = ブランク/I/N）。物理だけで測ると `I` `N` を弾いてしまう。
 *   - 印刷装置 17 桁は実機が `H` を受けるのに原典に無く、**一致しないので
 *     `false` のまま**にしてある。
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
