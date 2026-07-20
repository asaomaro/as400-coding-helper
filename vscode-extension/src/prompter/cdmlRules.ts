/**
 * CDML 由来の相関規則（DEP / PMTCTL）の評価。
 *
 * 定義データは CDML をそのまま写した形（types.ts の CommandDependency /
 * PromptControlGroup）なので、ここが「意味を与える」唯一の場所になる。
 * 実機に問い合わせず、入力値だけでローカルに評価する。
 *
 * **評価の本体は createCdmlEvaluator 1 つに閉じてある。**
 * プロンプターは WebView 側でも入力のたびに再評価する必要があるが、そこに写しを
 * 手書きすると必ず食い違う（`dependsOn` と `constraints` は既に写しが 2 本あり、
 * binding.ts に「片方だけ直すと食い違う」と注意書きが要る状態になっている）。
 * この関数はモジュール・スコープの何にも依存しない自己完結な作りにしてあり、
 * binding.ts は `String(createCdmlEvaluator)` をそのまま script に埋め込む。
 * 写しではなく同一の関数が動くので、食い違いようがない。
 *
 * したがって **この関数の中から外の識別子を参照してはいけない**
 * （型注釈は消えるので可）。ヘルパはすべて内側に置く。
 */
import type {
  CommandDependency,
  ParameterDefinition,
  PrompterDefinition,
  PromptControlGroup
} from "./types";

/** 評価に要るデータ。定義から抜き出して WebView にも同じものを渡す。 */
export interface CdmlEvaluatorSpec {
  readonly dependencies?: readonly CommandDependency[];
  /** パラメータ名 → 既定値。「指定された(SPCFD)」の判定に使う。 */
  readonly defaults?: Readonly<Record<string, string>>;
  /** パラメータ名 → 書く値 → 内部値(MapTo)。 */
  readonly valueMaps?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface DependencyViolation {
  readonly messageId?: string;
  readonly message: string;
}

export interface CdmlEvaluator {
  /** 既定値のままは「指定された」ではない。 */
  isSpecified(parameter: string, values: Record<string, string | undefined>): boolean;
  /** 書く値 → 内部値。 */
  resolve(parameter: string, value: string): string;
  /** PMTCTL を評価して、この欄を表示するかを返す。 */
  promptControlHolds(
    groups: readonly PromptControlGroup[] | undefined,
    values: Record<string, string | undefined>
  ): boolean;
  /** DEP を評価して違反を返す。 */
  checkDependencies(values: Record<string, string | undefined>): DependencyViolation[];
}

export function createCdmlEvaluator(spec: CdmlEvaluatorSpec): CdmlEvaluator {
  const dependencies = spec.dependencies || [];
  const defaults: Record<string, string> = (spec.defaults || {}) as Record<
    string,
    string
  >;
  const valueMaps: Record<string, Record<string, string>> = (spec.valueMaps ||
    {}) as Record<string, Record<string, string>>;

  const normalize = (value: string | undefined): string =>
    String(value === undefined || value === null ? "" : value)
      .trim()
      .toUpperCase();

  /**
   * 「指定された」判定。
   * CL の相関は対象がほぼ全て既定値を持つため、値の有無だけで判定すると常に
   * 成立してしまう（実際 100 コマンド中 47 コマンドで、開いた瞬間に誤った
   * エラーが出ていた）。
   */
  const isSpecified = (
    parameter: string,
    values: Record<string, string | undefined>
  ): boolean => {
    const actual = normalize(values[parameter]);
    if (actual.length === 0) {
      return false;
    }
    const fallback = defaults[parameter];
    return fallback === undefined || actual !== normalize(fallback);
  };

  /** 書く値と内部値は食い違うことが多い（*PRINT → L など）。必ず通す。 */
  const resolve = (parameter: string, value: string): string => {
    const table = valueMaps[parameter];
    const key = normalize(value);
    return table && table[key] !== undefined ? normalize(table[key]) : key;
  };

  /**
   * 値を空白区切りの要素に割る。複数指定できる欄（SAVOBJ の DEV など）を
   * 単一値として比べると `DEV(*TAPE *SAVF)` で規則が外れる。
   */
  const tokens = (value: string | undefined): string[] => {
    const text = normalize(value);
    return text.length > 0 ? text.split(/\s+/) : [];
  };

  const compareOrdered = (left: string, right: string, relation: string): boolean => {
    const a = Number(left);
    const b = Number(right);
    // 数値として読めるときだけ数値で比べる。桁数の違う数値の文字列比較を避ける。
    const numeric = !Number.isNaN(a) && !Number.isNaN(b) && left !== "" && right !== "";
    const diff = numeric ? a - b : left < right ? -1 : left > right ? 1 : 0;
    if (relation === "GT") return diff > 0;
    if (relation === "GE") return diff >= 0;
    if (relation === "LT") return diff < 0;
    if (relation === "LE") return diff <= 0;
    return false;
  };

  const valueMatches = (
    actual: readonly string[],
    expected: string,
    relation: string
  ): boolean => {
    if (relation === "EQ") {
      return actual.some(token => token === expected);
    }
    if (relation === "NE") {
      // 「どの要素も一致しない」。未指定は比較不能として偽にする。
      return actual.length > 0 && !actual.some(token => token === expected);
    }
    return actual.some(token => compareOrdered(token, expected, relation));
  };

  /** 成立した個数が閾値の条件を満たすか。ALL は「全て成立」。 */
  const countSatisfies = (
    trueCount: number,
    total: number,
    relation: string,
    threshold: number | undefined
  ): boolean => {
    if (relation === "ALL") return trueCount === total;
    const target = threshold === undefined ? 0 : threshold;
    if (relation === "EQ") return trueCount === target;
    if (relation === "NE") return trueCount !== target;
    if (relation === "GT") return trueCount > target;
    if (relation === "GE") return trueCount >= target;
    if (relation === "LT") return trueCount < target;
    if (relation === "LE") return trueCount <= target;
    return false;
  };

  /**
   * PMTCTL を評価する。グループは logicalRelation で**左から順に**連ねる
   * （先頭のグループにはこの属性が無い）。未指定は AND として扱う。
   */
  const promptControlHolds = (
    groups: readonly PromptControlGroup[] | undefined,
    values: Record<string, string | undefined>
  ): boolean => {
    if (!groups || groups.length === 0) {
      return true;
    }
    let result = true;
    groups.forEach((group, index) => {
      const actual = tokens(values[group.controlParameter]).map(token =>
        resolve(group.controlParameter, token)
      );
      const specified = isSpecified(group.controlParameter, values);

      const trueCount = group.conditions.filter(condition => {
        if (condition.relation === "SPCFD") return specified;
        if (condition.relation === "UNSPCFD") return !specified;
        const expected = resolve(
          group.controlParameter,
          condition.compareValue === undefined ? "" : condition.compareValue
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
  };

  /**
   * 違反の文面を規則の構造から組み立てる。
   *
   * CDML はメッセージ ID しか持たない（文面は実機のメッセージ・ファイルにあり、
   * pub400 は英語システムのため日本語では取れない。QSYS2962 をライブラリー・
   * リストに入れて LANGID(JPN) にしても *CMD 側の CCSID 37 のままだった）。
   * 生の `CPD2441` を出しても意味が通らないので、規則から日本語の文を作る。
   */
  const describe = (dependency: CommandDependency): string => {
    const comparison = (relation: string, value: string): string => {
      if (relation === "EQ") return value + " のとき";
      if (relation === "NE") return value + " 以外のとき";
      if (relation === "GT") return value + " より大きいとき";
      if (relation === "GE") return value + " 以上のとき";
      if (relation === "LT") return value + " より小さいとき";
      if (relation === "LE") return value + " 以下のとき";
      return value + " のとき";
    };

    let condition = "";
    if (dependency.controlRelation === "SPCFD" && dependency.controlParameter) {
      condition = dependency.controlParameter + " を指定した場合、";
    } else if (dependency.controlRelation !== "ALWAYS" && dependency.controlParameter) {
      const target =
        dependency.controlCompareParameter || dependency.controlCompareValue || "";
      condition =
        dependency.controlParameter +
        " が " +
        comparison(dependency.controlRelation, target) +
        "、";
    }

    const names = dependency.terms.map(term =>
      term.relation === "SPCFD"
        ? term.parameter
        : term.parameter +
          "(" +
          (term.compareParameter || term.compareValue || "") +
          ")"
    );
    const list = names.join("、");
    const count = dependency.count === undefined ? 0 : dependency.count;
    const allSpecified = dependency.terms.every(term => term.relation === "SPCFD");

    let requirement: string;
    if (dependency.countRelation === "ALL") {
      requirement = list + " をすべて指定してください。";
    } else if (dependency.countRelation === "EQ" && count === 0) {
      requirement = allSpecified
        ? list + " は指定できません。"
        : list + " の条件は満たせません。";
    } else if (dependency.countRelation === "EQ" && count === 1) {
      requirement =
        dependency.terms.length === 1
          ? list + " を指定してください。"
          : list + " のいずれか 1 つだけを指定してください。";
    } else if (dependency.countRelation === "GE" || dependency.countRelation === "GT") {
      const least = dependency.countRelation === "GT" ? count + 1 : count;
      requirement = list + " のうち " + least + " つ以上を指定してください。";
    } else if (dependency.countRelation === "LE" || dependency.countRelation === "LT") {
      const most = dependency.countRelation === "LT" ? count - 1 : count;
      requirement = list + " のうち指定できるのは " + most + " つまでです。";
    } else {
      requirement = list + " の指定の組み合わせが正しくありません。";
    }

    return (
      condition +
      requirement +
      (dependency.messageId ? "(" + dependency.messageId + ")" : "")
    );
  };

  const controlHolds = (
    dependency: CommandDependency,
    values: Record<string, string | undefined>
  ): boolean => {
    if (dependency.controlRelation === "ALWAYS") return true;
    const parameter = dependency.controlParameter;
    if (!parameter) return false;
    if (dependency.controlRelation === "SPCFD") {
      return isSpecified(parameter, values);
    }
    const actual = tokens(values[parameter]).map(token => resolve(parameter, token));
    const expected = dependency.controlCompareParameter
      ? normalize(values[dependency.controlCompareParameter])
      : resolve(
          parameter,
          dependency.controlCompareValue === undefined
            ? ""
            : dependency.controlCompareValue
        );
    return valueMatches(actual, expected, dependency.controlRelation);
  };

  const countTrueTerms = (
    dependency: CommandDependency,
    values: Record<string, string | undefined>
  ): number =>
    dependency.terms.filter(term => {
      if (term.relation === "SPCFD") {
        return isSpecified(term.parameter, values);
      }
      const actual = tokens(values[term.parameter]).map(token =>
        resolve(term.parameter, token)
      );
      const expected = term.compareParameter
        ? normalize(values[term.compareParameter])
        : resolve(
            term.parameter,
            term.compareValue === undefined ? "" : term.compareValue
          );
      return valueMatches(actual, expected, term.relation);
    }).length;

  const checkDependencies = (
    values: Record<string, string | undefined>
  ): DependencyViolation[] => {
    const violations: DependencyViolation[] = [];
    for (const dependency of dependencies) {
      // **触っていない欄について違反を出さない。**
      // 実機の F4 も入力前は何も出さず、DEP は投入時に検査される。
      const mentioned = [dependency.controlParameter].concat(
        dependency.terms.map(term => term.parameter)
      );
      if (!mentioned.some(name => name && isSpecified(name, values))) {
        continue;
      }
      if (!controlHolds(dependency, values)) {
        continue;
      }
      const satisfied = countSatisfies(
        countTrueTerms(dependency, values),
        dependency.terms.length,
        dependency.countRelation,
        dependency.count
      );
      if (satisfied) {
        continue;
      }
      violations.push({
        messageId: dependency.messageId,
        message: dependency.message || describe(dependency)
      });
    }
    return violations;
  };

  return { isSpecified, resolve, promptControlHolds, checkDependencies };
}

/* ------------------------------------------------------------------ *
 * 定義からの組み立て
 * ------------------------------------------------------------------ */

/** 定義から評価に要るデータだけを抜き出す。WebView へはこれを JSON で渡す。 */
export function buildEvaluatorSpec(definition: PrompterDefinition): CdmlEvaluatorSpec {
  const defaults: Record<string, string> = {};
  const valueMaps: Record<string, Record<string, string>> = {};

  const walk = (parameters: readonly ParameterDefinition[]): void => {
    for (const parameter of parameters) {
      if (parameter.defaultValue !== undefined) {
        defaults[parameter.name] = parameter.defaultValue;
      }
      if (parameter.valueMap) {
        valueMaps[parameter.name] = { ...parameter.valueMap };
      }
      if (parameter.children) {
        walk(parameter.children);
      }
    }
  };
  walk(definition.parameters);

  return { dependencies: definition.dependencies, defaults, valueMaps };
}

/** 定義から評価器を作る。 */
export function buildRuleContext(definition: PrompterDefinition): CdmlEvaluator {
  return createCdmlEvaluator(buildEvaluatorSpec(definition));
}

/** 呼び出し側は「評価に要る文脈」として受け取る。 */
export type RuleContext = CdmlEvaluator;

export function promptControlHolds(
  groups: readonly PromptControlGroup[] | undefined,
  values: Record<string, string | undefined>,
  context: CdmlEvaluator
): boolean {
  return context.promptControlHolds(groups, values);
}

export function checkDependencies(
  definition: PrompterDefinition,
  values: Record<string, string | undefined>,
  context: CdmlEvaluator = buildRuleContext(definition)
): DependencyViolation[] {
  return context.checkDependencies(values);
}
