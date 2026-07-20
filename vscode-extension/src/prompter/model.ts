import type { PrompterDefinition, ParameterDefinition } from "./types";
import { buildRuleContext, checkDependencies, type RuleContext } from "./cdmlRules";
import { evaluateParameter } from "./visibilityRules";
import {
  countOccurrences,
  isRepeatableGroup,
  occurrenceName
} from "./occurrences";

export interface FieldValue {
  readonly parameter: ParameterDefinition;
  /** フォーム上の入力欄名。繰り返しの2件目以降は `名前#2` になる。 */
  readonly fieldName: string;
  /** 繰り返し指定の何件目か（0 始まり）。 */
  readonly occurrence: number;
  readonly value: string;
  readonly error?: string;
  // dependsOn 評価後の実効状態。静的な parameter.required とは異なりうる。
  readonly required: boolean;
  readonly visible: boolean;
  readonly disabled: boolean;
  readonly allowedValues?: readonly string[];
}

export interface PrompterState {
  readonly keyword: string;
  readonly fields: FieldValue[];
  readonly hasErrors: boolean;
  // コマンド単位の相関制約（排他 / 相互必須）の違反。
  readonly constraintErrors: string[];
}

/**
 * 入力欄を持つ末端パラメータを取り出す。group は入れ子になりうるため再帰的に辿る
 * （例: ALCOBJ の OBJ は「要素リストの要素1が修飾名」という2階層構造）。
 */
function flattenParameters(
  parameters: readonly ParameterDefinition[]
): ParameterDefinition[] {
  const result: ParameterDefinition[] = [];

  for (const parameter of parameters) {
    if (
      parameter.inputType === "group" &&
      Array.isArray(parameter.children) &&
      parameter.children.length > 0
    ) {
      // group は入力欄を持たないので、group に付いた dependsOn は末端へ渡す。
      // 渡さないと、原典どおり「このパラメーターは必須」と書いた規則が
      // どこにも効かず、黙って無視される（SNDPGMMSG の MSGF で踏んだ）。
      // 末端が自前の規則を持つ場合はそちらを優先する。
      // CDML の PMTCTL も同じ理由で降ろす。<Parm> に付く規則を group に置くと
      // 入力欄が無いため効かない。
      const children = (parameter.dependsOn || parameter.promptControl
        ? parameter.children.map(child => ({
            ...child,
            dependsOn: child.dependsOn ?? parameter.dependsOn,
            promptControl: child.promptControl ?? parameter.promptControl
          }))
        : parameter.children) as ParameterDefinition[];

      result.push(...flattenParameters(children));
    } else {
      result.push(parameter);
    }
  }

  return result;
}

/**
 * 入力欄を、繰り返し指定の件数だけ展開して並べる。
 * 2件目以降の入力欄名は `名前#2` のように連番になる（occurrences.ts の規則）。
 */
function expandOccurrences(
  parameters: readonly ParameterDefinition[],
  values: Record<string, string | undefined>
): { parameter: ParameterDefinition; occurrence: number; fieldName: string }[] {
  const result: {
    parameter: ParameterDefinition;
    occurrence: number;
    fieldName: string;
  }[] = [];

  for (const parameter of parameters) {
    const count = isRepeatableGroup(parameter) ? countOccurrences(parameter, values) : 1;

    for (let occurrence = 0; occurrence < count; occurrence += 1) {
      for (const leaf of flattenParameters([parameter])) {
        result.push({
          parameter: leaf,
          occurrence,
          fieldName: occurrenceName(leaf.name, occurrence)
        });
      }
    }
  }

  return result;
}

export function buildInitialState(
  definition: PrompterDefinition,
  initialValues: Record<string, string | undefined>
): PrompterState {
  const slots = expandOccurrences(definition.parameters, initialValues);
  // CDML 由来の規則は内部値(MapTo)で比較し、「指定された」は既定値と区別する。
  // 定義から作って渡さないと、条件表示が効かない／既定値のままで誤った違反が出る。
  const context = buildRuleContext(definition);

  // dependsOn は他パラメータの確定値を参照するため、先に全項目の値を determine する。
  const resolvedValues: Record<string, string | undefined> = {};
  for (const slot of slots) {
    resolvedValues[slot.fieldName] =
      initialValues[slot.fieldName] ??
      // 2件目以降に既定値を勝手に入れると、空のはずの繰り返しが出力されてしまう。
      (slot.occurrence === 0 ? slot.parameter.defaultValue ?? "" : "");
  }

  const fields: FieldValue[] = slots.map(slot => {
    const raw = resolvedValues[slot.fieldName] ?? "";
    const { visible, required, disabled, allowedValues } = evaluateParameter(
      slot.parameter,
      resolvedValues,
      context
    );
    // 初期表示では「必須なのに空」をエラーにしない。開いた瞬間に赤字が並ぶと
    // 警告として機能しなくなる（実機の F4 も入力前は何も出さない）。
    // 未入力は必須マーク（*）で示し、送信時にクライアント側が検証する。
    const error =
      raw.trim().length === 0 && required
        ? undefined
        : validate(slot.parameter, raw, required, allowedValues);

    return {
      parameter: slot.parameter,
      fieldName: slot.fieldName,
      occurrence: slot.occurrence,
      value: raw,
      error,
      required,
      visible,
      disabled,
      allowedValues
    };
  });

  const constraintErrors = validateConstraints(definition, resolvedValues, context);
  const hasErrors =
    fields.some(field => Boolean(field.error)) || constraintErrors.length > 0;

  return {
    keyword: definition.keyword,
    fields,
    hasErrors,
    constraintErrors
  };
}

/**
 * コマンド単位の相関制約（排他 / 相互必須）を検証する。
 * 個々のパラメータには属さないため、状態のトップに結果を持たせる。
 */
export function validateConstraints(
  definition: PrompterDefinition,
  values: Record<string, string | undefined>,
  context: RuleContext = buildRuleContext(definition)
): string[] {
  // CDML(DEP) 由来の相関チェック。散文由来の constraints と併せて一覧に出す。
  const errors: string[] = checkDependencies(definition, values, context).map(
    violation => violation.message
  );
  const byName = new Map(definition.parameters.map(p => [p.name, p]));

  // 「指定した」とは、既定値のままではないこと。CL の相関はほぼ全ての
  // 対象パラメータが既定値を持つため、値の有無で判定すると常に成立してしまう。
  const isFilled = (name: string): boolean => {
    const parameter = byName.get(name);
    if (!parameter) {
      return (values[name] ?? "").trim().length > 0;
    }

    return flattenParameters([parameter]).some(leaf => {
      const value = (values[leaf.name] ?? "").trim();
      if (value.length === 0) {
        return false;
      }
      return value.toUpperCase() !== (leaf.defaultValue ?? "").trim().toUpperCase();
    });
  };

  for (const constraint of definition.constraints ?? []) {
    const filled = constraint.parameters.filter(isFilled);

    if (constraint.kind === "exclusive" && filled.length > 1) {
      errors.push(
        constraint.note ??
          `${constraint.parameters.join(" と ")} は同時に指定できません（指定: ${filled.join(", ")}）。`
      );
    }

    if (
      constraint.kind === "together" &&
      filled.length > 0 &&
      filled.length < constraint.parameters.length
    ) {
      const missing = constraint.parameters.filter(name => !isFilled(name));
      errors.push(
        constraint.note ??
          `${constraint.parameters.join(" と ")} は一緒に指定する必要があります（未指定: ${missing.join(", ")}）。`
      );
    }
  }

  return errors;
}

export function validate(
  parameter: ParameterDefinition,
  value: string,
  // dependsOn 評価後の実効必須。未指定なら定義上の required を使う。
  requiredOverride?: boolean,
  // dependsOn の allowedValues により絞り込まれた許可値。
  allowedValues?: readonly string[]
): string | undefined {
  const trimmed = value.trim();
  const required = requiredOverride ?? parameter.required;

  if (required && trimmed.length === 0) {
    return "値の入力が必要です。";
  }

  if (parameter.attributes?.maxLength !== undefined) {
    if (trimmed.length > parameter.attributes.maxLength) {
      return `${parameter.attributes.maxLength} 文字以内で入力してください。`;
    }
  }

  // 数値項目でも、定義済み値（*DEVD 等）・小数・符号は正当に現れる。
  // 整数だけに限ると CPYF の STARTNBR(1.00) や CRTPRTF の DOWN(*DEVD) を誤って弾く。
  if (parameter.attributes?.numericOnly && trimmed.length > 0 && !trimmed.startsWith("*")) {
    if (!/^[+-]?[0-9]+(?:\.[0-9]+)?$/u.test(trimmed)) {
      return "数値を入力してください。";
    }
  }

  if (parameter.attributes?.characterSet && trimmed.length > 0) {
    if (parameter.attributes.characterSet === "upper") {
      if (trimmed !== trimmed.toUpperCase()) {
        return "英大文字で入力してください。";
      }
    }
  }

  // コメント以外の項目については、数値専用でなく、かつ
  // characterSet が英数字系 (alpha/alnum/upper) の場合のみ文字種を制限する。
  //
  // CL の値には英数字以外が正当に現れる。取りこぼすと正しい値を誤って
  // 弾いてしまう（実際に全入力欄 1,542 のうち 1,013 が初期表示でエラーに
  // なっていた。*FILE / *EXCL / *SAME などの定義済み値がすべて弾かれていた）。
  //   *     定義済み値              例: *FILE, *SAME
  //   /     修飾名の区切り          例: QGPL/MYFILE
  //   &     CL 変数                 例: &LIBNAME
  //   . -   限定名・日付・負数      例: MYLIB.MYOBJ, -1
  //   ' "   文字リテラル            例: 'ABC'
  const charset = parameter.attributes?.characterSet;
  if (
    parameter.name !== "COMMENT" &&
    !parameter.attributes?.numericOnly &&
    trimmed.length > 0 &&
    charset &&
    (charset === "alpha" || charset === "alnum" || charset === "upper")
  ) {
    if (!/^[A-Za-z0-9_ *\/&.\-'"()#@$]+$/u.test(trimmed)) {
      return "使用できない文字が含まれています。";
    }
  }

  // options は「制限」とは限らない。実機が Rstd=NO と言っている欄では、
  // 列挙した値は候補にすぎず任意の値を書ける。
  if (
    parameter.attributes?.restricted !== false &&
    parameter.options &&
    parameter.options.length > 0
  ) {
    const allowed = parameter.options.map(option => option.value);
    if (trimmed.length > 0 && !allowed.includes(trimmed)) {
      return "指定できない値です。";
    }
  }

  // 他パラメータの値により選択肢が絞られている場合の相関チェック。
  if (allowedValues && allowedValues.length > 0 && trimmed.length > 0) {
    const permitted = allowedValues.some(
      value => value.trim().toUpperCase() === trimmed.toUpperCase()
    );
    if (!permitted) {
      return `現在の指定では ${allowedValues.join(" / ")} のみ指定できます。`;
    }
  }

  return undefined;
}
