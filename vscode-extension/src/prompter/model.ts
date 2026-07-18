import type { PrompterDefinition, ParameterDefinition } from "./types";
import { evaluateParameter } from "./visibilityRules";

export interface FieldValue {
  readonly parameter: ParameterDefinition;
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
      result.push(...flattenParameters(parameter.children));
    } else {
      result.push(parameter);
    }
  }

  return result;
}

export function buildInitialState(
  definition: PrompterDefinition,
  initialValues: Record<string, string | undefined>
): PrompterState {
  const flatParameters = flattenParameters(definition.parameters);

  // dependsOn は他パラメータの確定値を参照するため、先に全項目の値を determine する。
  const resolvedValues: Record<string, string | undefined> = {};
  for (const parameter of flatParameters) {
    resolvedValues[parameter.name] =
      initialValues[parameter.name] ?? parameter.defaultValue ?? "";
  }

  const fields: FieldValue[] = flatParameters.map(parameter => {
    const raw = resolvedValues[parameter.name] ?? "";
    const { visible, required, disabled, allowedValues } = evaluateParameter(
      parameter,
      resolvedValues
    );
    const error = validate(parameter, raw, required, allowedValues);

    return {
      parameter,
      value: raw,
      error,
      required,
      visible,
      disabled,
      allowedValues
    };
  });

  const constraintErrors = validateConstraints(definition, resolvedValues);
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
  values: Record<string, string | undefined>
): string[] {
  const errors: string[] = [];
  const isFilled = (name: string) => (values[name] ?? "").trim().length > 0;

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
    return "A value is required.";
  }

  if (parameter.attributes?.maxLength !== undefined) {
    if (trimmed.length > parameter.attributes.maxLength) {
      return `Value must be at most ${parameter.attributes.maxLength} characters.`;
    }
  }

  if (parameter.attributes?.numericOnly && trimmed.length > 0) {
    if (!/^[0-9]+$/u.test(trimmed)) {
      return "Only numeric characters are allowed.";
    }
  }

  if (parameter.attributes?.characterSet && trimmed.length > 0) {
    if (parameter.attributes.characterSet === "upper") {
      if (trimmed !== trimmed.toUpperCase()) {
        return "Value must be upper case.";
      }
    }
  }

  // コメント以外の項目については、数値専用でなく、かつ
  // characterSet が英数字系 (alpha/alnum/upper) の場合のみ
  // 英数字と空白/アンダースコアに制限する。
  const charset = parameter.attributes?.characterSet;
  if (
    parameter.name !== "COMMENT" &&
    !parameter.attributes?.numericOnly &&
    trimmed.length > 0 &&
    charset &&
    (charset === "alpha" || charset === "alnum" || charset === "upper")
  ) {
    if (!/^[A-Za-z0-9_ ]+$/u.test(trimmed)) {
      return "Only alphanumeric characters are allowed.";
    }
  }

  if (parameter.options && parameter.options.length > 0) {
    const allowed = parameter.options.map(option => option.value);
    if (trimmed.length > 0 && !allowed.includes(trimmed)) {
      return "Value is not in the allowed set.";
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
