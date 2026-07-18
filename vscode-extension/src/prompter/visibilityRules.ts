import type {
  ParameterCondition,
  ParameterDefinition,
  ParameterDependency
} from "./types";

export interface EffectiveParameterState {
  readonly visible: boolean;
  readonly required: boolean;
  readonly disabled: boolean;
  // 条件成立により入力可能な値が絞られている場合のみ設定される。
  readonly allowedValues?: readonly string[];
}

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function conditionHolds(
  condition: ParameterCondition,
  values: Record<string, string | undefined>
): boolean {
  const actual = normalize(values[condition.parameter]);

  if (condition.equalsAny && condition.equalsAny.length > 0) {
    if (!condition.equalsAny.some(candidate => normalize(candidate) === actual)) {
      return false;
    }
  }

  if (condition.notEqualsAny && condition.notEqualsAny.length > 0) {
    if (condition.notEqualsAny.some(candidate => normalize(candidate) === actual)) {
      return false;
    }
  }

  return true;
}

/** 依存規則が成立するか。all があれば全条件の AND、無ければ単一条件で判定する。 */
export function dependencyHolds(
  dependency: ParameterDependency,
  values: Record<string, string | undefined>
): boolean {
  if (dependency.all && dependency.all.length > 0) {
    return dependency.all.every(condition => conditionHolds(condition, values));
  }

  if (!dependency.parameter) {
    return false;
  }

  return conditionHolds(dependency as ParameterCondition, values);
}

/**
 * dependsOn を現在の入力値で評価し、実効的な表示/必須/入力可否/許可値を返す。
 *
 * - 該当 effect の規則が1つでもあれば、その効果は「いずれかの規則が成立したときのみ」に
 *   切り替わる（静的な required / visibleByDefault より優先する）。
 * - 既に値が入っている項目は条件に関わらず隠さない（入力済みの値を握り潰さないため）。
 */
export function evaluateParameter(
  definition: ParameterDefinition,
  values: Record<string, string | undefined>
): EffectiveParameterState {
  const hasExistingValue = normalize(values[definition.name]).length > 0;
  const dependencies = definition.dependsOn ?? [];
  const of = (effect: ParameterDependency["effect"]) =>
    dependencies.filter(rule => rule.effect === effect);

  const requiredRules = of("required");
  const visibleRules = of("visible");
  const disabledRules = of("disabled");
  const allowedRules = of("allowedValues");

  const required =
    requiredRules.length > 0
      ? requiredRules.some(rule => dependencyHolds(rule, values))
      : definition.required;

  const visible = (() => {
    if (hasExistingValue) {
      return true;
    }
    if (visibleRules.length > 0) {
      return visibleRules.some(rule => dependencyHolds(rule, values));
    }
    return definition.visibleByDefault !== false;
  })();

  const disabled = disabledRules.some(rule => dependencyHolds(rule, values));

  // 成立した allowedValues 規則の積集合が、実際に入力できる値になる。
  const activeAllowed = allowedRules
    .filter(rule => dependencyHolds(rule, values))
    .map(rule => rule.allowedValues ?? []);

  const allowedValues =
    activeAllowed.length > 0
      ? activeAllowed.reduce((acc, list) =>
          acc.filter(value => list.some(candidate => normalize(candidate) === normalize(value)))
        )
      : undefined;

  return { visible, required: required && !disabled, disabled, allowedValues };
}
