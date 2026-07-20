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

/**
 * 「指定された(SPCFD)」の判定。
 *
 * **既定値のままは「指定された」ではない。** CL の相関は対象パラメータがほぼ全て
 * 既定値を持つため、値の有無だけで判定すると常に成立してしまう
 * （実際、開いた瞬間に 100 コマンド中 47 コマンドで誤ったエラーが出ていた）。
 * 同じ判断が model.ts の validateConstraints にもある。
 */
export type SpecifiedPredicate = (
  parameter: string,
  values: Record<string, string | undefined>
) => boolean;

export interface RuleContext {
  readonly resolve: InternalValueResolver;
  readonly isSpecified: SpecifiedPredicate;
}

/** 定義から「指定されたか」の判定を作る。既定値と一致するものは未指定とみなす。 */
export function buildSpecifiedPredicate(
  definition: PrompterDefinition
): SpecifiedPredicate {
  const defaults = new Map<string, string>();
  const walk = (parameters: readonly ParameterDefinition[]): void => {
    for (const parameter of parameters) {
      if (parameter.defaultValue !== undefined) {
        defaults.set(parameter.name, normalize(parameter.defaultValue));
      }
      if (parameter.children) {
        walk(parameter.children);
      }
    }
  };
  walk(definition.parameters);

  return (parameter, values) => {
    const actual = normalize(values[parameter]);
    if (actual.length === 0) {
      return false;
    }
    const fallback = defaults.get(parameter);
    return fallback === undefined || actual !== fallback;
  };
}

/** 定義から評価に要る文脈をまとめて作る。 */
export function buildRuleContext(definition: PrompterDefinition): RuleContext {
  return {
    resolve: buildInternalValueResolver(definition),
    isSpecified: buildSpecifiedPredicate(definition)
  };
}

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
      if (parameter.valueMap) {
        const byValue = new Map<string, string>();
        for (const [value, internal] of Object.entries(parameter.valueMap)) {
          byValue.set(normalize(value), normalize(internal));
        }
        table.set(parameter.name, byValue);
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
  context: RuleContext
): boolean {
  if (groups.length === 0) {
    return true;
  }

  let result = true;
  groups.forEach((group, index) => {
    const actual = tokens(values[group.controlParameter]).map(token =>
      context.resolve(group.controlParameter, token)
    );
    const specified = context.isSpecified(group.controlParameter, values);

    const trueCount = group.conditions.filter(condition => {
      if (condition.relation === "SPCFD") {
        return specified;
      }
      if (condition.relation === "UNSPCFD") {
        return !specified;
      }
      const expected = context.resolve(
        group.controlParameter,
        condition.compareValue ?? ""
      );
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

/**
 * 違反の文面を規則の構造から組み立てる。
 *
 * CDML はメッセージ ID しか持たない（文面は実機のメッセージ・ファイルにあり、
 * pub400 は英語システムのため日本語では取れない。ライブラリー・リストに
 * QSYS2962 を入れて LANGID(JPN) にしても *CMD 側の CCSID 37 のままだった）。
 * 生の `CPD2441` を画面に出しても利用者には意味が通らないので、規則そのものから
 * 日本語の文を作る。ID は追跡できるよう末尾に残す。
 */
export function describeDependency(dependency: CommandDependency): string {
  const relationText: Record<string, string> = {
    EQ: "が",
    NE: "が",
    GT: "が",
    GE: "が",
    LT: "が",
    LE: "が"
  };
  const comparison = (relation: string, value: string): string => {
    switch (relation) {
      case "EQ":
        return `${value} のとき`;
      case "NE":
        return `${value}以外のとき`;
      case "GT":
        return `${value} より大きいとき`;
      case "GE":
        return `${value} 以上のとき`;
      case "LT":
        return `${value} より小さいとき`;
      case "LE":
        return `${value} 以下のとき`;
      default:
        return `${value} のとき`;
    }
  };

  // 前段（この規則がいつ効くか）。
  let condition = "";
  if (dependency.controlRelation === "SPCFD" && dependency.controlParameter) {
    condition = `${dependency.controlParameter} を指定した場合、`;
  } else if (dependency.controlRelation !== "ALWAYS" && dependency.controlParameter) {
    const target =
      dependency.controlCompareParameter ?? dependency.controlCompareValue ?? "";
    condition =
      `${dependency.controlParameter}${relationText[dependency.controlRelation] ?? "が"} ` +
      `${comparison(dependency.controlRelation, target)}、`;
  }

  // 後段（何を満たすべきか）。
  const names = dependency.terms.map(term =>
    term.relation === "SPCFD"
      ? term.parameter
      : `${term.parameter}(${term.compareParameter ?? term.compareValue ?? ""})`
  );
  const list = names.join("、");
  const count = dependency.count ?? 0;
  const allSpecified = dependency.terms.every(term => term.relation === "SPCFD");

  let requirement: string;
  if (dependency.countRelation === "ALL") {
    requirement = `${list} をすべて指定してください。`;
  } else if (dependency.countRelation === "EQ" && count === 0) {
    requirement = allSpecified
      ? `${list} は指定できません。`
      : `${list} の条件は満たせません。`;
  } else if (dependency.countRelation === "EQ" && count === 1) {
    requirement =
      dependency.terms.length === 1
        ? `${list} を指定してください。`
        : `${list} のいずれか 1 つだけを指定してください。`;
  } else if (dependency.countRelation === "GE" || dependency.countRelation === "GT") {
    const least = dependency.countRelation === "GT" ? count + 1 : count;
    requirement = `${list} のうち ${least} つ以上を指定してください。`;
  } else if (dependency.countRelation === "LE" || dependency.countRelation === "LT") {
    const most = dependency.countRelation === "LT" ? count - 1 : count;
    requirement = `${list} のうち指定できるのは ${most} つまでです。`;
  } else {
    requirement = `${list} の指定の組み合わせが正しくありません。`;
  }

  const suffix = dependency.messageId ? `(${dependency.messageId})` : "";
  return `${condition}${requirement}${suffix}`;
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
  context: RuleContext
): boolean {
  if (dependency.controlRelation === "ALWAYS") {
    return true;
  }
  const parameter = dependency.controlParameter;
  if (!parameter) {
    return false;
  }
  if (dependency.controlRelation === "SPCFD") {
    return context.isSpecified(parameter, values);
  }
  const actual = tokens(values[parameter]).map(token =>
    context.resolve(parameter, token)
  );
  const expected = dependency.controlCompareParameter
    ? normalize(values[dependency.controlCompareParameter])
    : context.resolve(parameter, dependency.controlCompareValue ?? "");

  return valueMatches(actual, expected, dependency.controlRelation);
}

/** DEP の数え上げ対象（DepParm）のうち、成立している個数。 */
function countTrueTerms(
  dependency: CommandDependency,
  values: Record<string, string | undefined>,
  context: RuleContext
): number {
  return dependency.terms.filter(term => {
    if (term.relation === "SPCFD") {
      return context.isSpecified(term.parameter, values);
    }
    const actual = tokens(values[term.parameter]).map(token =>
      context.resolve(term.parameter, token)
    );
    const expected = term.compareParameter
      ? normalize(values[term.compareParameter])
      : context.resolve(term.parameter, term.compareValue ?? "");

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
  context: RuleContext = buildRuleContext(definition)
): DependencyViolation[] {
  const violations: DependencyViolation[] = [];

  for (const dependency of definition.dependencies ?? []) {
    // **触っていない欄について違反を出さない。**
    // 実機の F4 も入力前は何も出さず、DEP は投入時に検査される。既定値のまま
    // 開いただけで赤字が並ぶと警告として機能しない（既に model.ts の
    // validateConstraints が同じ判断をしている）。規則が名指しする欄が 1 つも
    // 指定されていなければ、その規則はまだ評価しない。
    const touched = [
      dependency.controlParameter,
      ...dependency.terms.map(term => term.parameter)
    ].some(parameter => parameter && context.isSpecified(parameter, values));
    if (!touched) {
      continue;
    }
    if (!controlHolds(dependency, values, context)) {
      continue;
    }
    const trueCount = countTrueTerms(dependency, values, context);
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
      message: dependency.message ?? describeDependency(dependency)
    });
  }

  return violations;
}
