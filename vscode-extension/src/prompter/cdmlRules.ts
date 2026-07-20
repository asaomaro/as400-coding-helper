/**
 * CDML 由来の相関規則（DEP / PMTCTL）の評価。
 *
 * 定義データは CDML をそのまま写した形（types.ts の CommandDependency /
 * PromptControlGroup）なので、ここが「意味を与える」唯一の場所になる。
 * 実機に問い合わせず、入力値だけでローカルに評価する。
 */
import type {
  CdmlCountRelation,
  CdmlRelation,
  CommandDependency,
  ParameterDefinition,
  PrompterDefinition,
  PromptControlGroup
} from "./types";

/** パラメータ名と表示値から内部値(MapTo)を引く。 */
export type InternalValueResolver = (parameter: string, value: string) => string;

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

/**
 * 定義から MapTo の変換表を作る。
 *
 * DEP / PMTCTL の CmpVal は**内部値**と比較する。表示値のまま比較すると規則が
 * 黙って成立しなくなるため、必ずこの変換を通す。group の子も対象にする
 * （入力欄を持つのは末端だけ、という PJ の規約に合わせる）。
 */
export function buildInternalValueResolver(
  definition: PrompterDefinition
): InternalValueResolver {
  const table = new Map<string, Map<string, string>>();

  const walk = (parameters: readonly ParameterDefinition[]): void => {
    for (const parameter of parameters) {
      for (const option of parameter.options ?? []) {
        if (!option.mapTo) {
          continue;
        }
        let byValue = table.get(parameter.name);
        if (!byValue) {
          byValue = new Map<string, string>();
          table.set(parameter.name, byValue);
        }
        byValue.set(normalize(option.value), normalize(option.mapTo));
      }
      if (parameter.children) {
        walk(parameter.children);
      }
    }
  };
  walk(definition.parameters);

  return (parameter, value) =>
    table.get(parameter)?.get(normalize(value)) ?? normalize(value);
}

/**
 * 値を空白区切りの要素に割る。
 *
 * 複数指定できるパラメータ（SAVOBJ の DEV など）があり、単一値として比較すると
 * 「DEV(*TAPE *SAVF)」で規則が成立しなくなる。要素のいずれかが一致すれば
 * 一致とみなす。
 */
function tokens(value: string | undefined): string[] {
  const text = normalize(value);
  return text.length > 0 ? text.split(/\s+/) : [];
}

function compareOrdered(left: string, right: string, relation: CdmlRelation): boolean {
  const a = Number(left);
  const b = Number(right);
  // 数値として読めるときだけ数値で比べる。桁数の違う数値の文字列比較を避ける。
  const numeric = !Number.isNaN(a) && !Number.isNaN(b) && left !== "" && right !== "";
  const diff = numeric ? a - b : left < right ? -1 : left > right ? 1 : 0;

  switch (relation) {
    case "GT":
      return diff > 0;
    case "GE":
      return diff >= 0;
    case "LT":
      return diff < 0;
    case "LE":
      return diff <= 0;
    default:
      return false;
  }
}

/** 実際の値（複数可）と比較値を、CDML の演算子で突き合わせる。 */
function valueMatches(
  actual: readonly string[],
  expected: string,
  relation: CdmlRelation
): boolean {
  if (relation === "EQ") {
    return actual.some(token => token === expected);
  }
  if (relation === "NE") {
    // 「どの要素も一致しない」。未指定は比較不能として偽にする。
    return actual.length > 0 && !actual.some(token => token === expected);
  }
  return actual.some(token => compareOrdered(token, expected, relation));
}

/** 成立した個数が閾値の条件を満たすか。ALL は「全て成立」。 */
function countSatisfies(
  trueCount: number,
  total: number,
  relation: CdmlCountRelation,
  threshold: number | undefined
): boolean {
  if (relation === "ALL") {
    return trueCount === total;
  }
  const target = threshold ?? 0;
  switch (relation) {
    case "EQ":
      return trueCount === target;
    case "NE":
      return trueCount !== target;
    case "GT":
      return trueCount > target;
    case "GE":
      return trueCount >= target;
    case "LT":
      return trueCount < target;
    case "LE":
      return trueCount <= target;
    default:
      return false;
  }
}

/**
 * PMTCTL を評価して「この欄を表示するか」を返す。
 *
 * グループは logicalRelation で**左から順に**連ねる（先頭にはこの属性が無い）。
 * 未指定は AND として扱う。
 */
export function promptControlHolds(
  groups: readonly PromptControlGroup[],
  values: Record<string, string | undefined>,
  resolve: InternalValueResolver
): boolean {
  if (groups.length === 0) {
    return true;
  }

  let result = true;
  groups.forEach((group, index) => {
    const actual = tokens(values[group.controlParameter]).map(token =>
      resolve(group.controlParameter, token)
    );

    const trueCount = group.conditions.filter(condition => {
      if (condition.relation === "SPCFD") {
        return actual.length > 0;
      }
      if (condition.relation === "UNSPCFD") {
        return actual.length === 0;
      }
      const expected = resolve(group.controlParameter, condition.compareValue ?? "");
      return valueMatches(actual, expected, condition.relation);
    }).length;

    const holds = countSatisfies(
      trueCount,
      group.conditions.length,
      group.countRelation,
      group.count
    );

    if (index === 0) {
      result = holds;
    } else if (group.logicalRelation === "OR") {
      result = result || holds;
    } else {
      result = result && holds;
    }
  });

  return result;
}

export interface DependencyViolation {
  readonly dependency: CommandDependency;
  readonly messageId?: string;
  readonly message: string;
}

/** DEP の制御条件（「この規則を適用するか」）が成立するか。 */
function controlHolds(
  dependency: CommandDependency,
  values: Record<string, string | undefined>,
  resolve: InternalValueResolver
): boolean {
  if (dependency.controlRelation === "ALWAYS") {
    return true;
  }
  const parameter = dependency.controlParameter;
  if (!parameter) {
    return false;
  }
  const actual = tokens(values[parameter]).map(token => resolve(parameter, token));

  if (dependency.controlRelation === "SPCFD") {
    return actual.length > 0;
  }
  const expected = dependency.controlCompareParameter
    ? normalize(values[dependency.controlCompareParameter])
    : resolve(parameter, dependency.controlCompareValue ?? "");

  return valueMatches(actual, expected, dependency.controlRelation);
}

/** DEP の数え上げ対象（DepParm）のうち、成立している個数。 */
function countTrueTerms(
  dependency: CommandDependency,
  values: Record<string, string | undefined>,
  resolve: InternalValueResolver
): number {
  return dependency.terms.filter(term => {
    const actual = tokens(values[term.parameter]).map(token =>
      resolve(term.parameter, token)
    );
    if (term.relation === "SPCFD") {
      return actual.length > 0;
    }
    const expected = term.compareParameter
      ? normalize(values[term.compareParameter])
      : resolve(term.parameter, term.compareValue ?? "");

    return valueMatches(actual, expected, term.relation);
  }).length;
}

/**
 * 定義の dependencies を現在の入力値で検査し、違反を返す。
 *
 * 制御条件が成立しない規則は「適用対象外」で違反にしない。
 */
export function checkDependencies(
  definition: PrompterDefinition,
  values: Record<string, string | undefined>,
  resolve: InternalValueResolver = buildInternalValueResolver(definition)
): DependencyViolation[] {
  const violations: DependencyViolation[] = [];

  for (const dependency of definition.dependencies ?? []) {
    if (!controlHolds(dependency, values, resolve)) {
      continue;
    }
    const trueCount = countTrueTerms(dependency, values, resolve);
    const satisfied = countSatisfies(
      trueCount,
      dependency.terms.length,
      dependency.countRelation,
      dependency.count
    );
    if (satisfied) {
      continue;
    }
    violations.push({
      dependency,
      messageId: dependency.messageId,
      message:
        dependency.message ??
        dependency.messageId ??
        "パラメーターの組み合わせが正しくありません。"
    });
  }

  return violations;
}
