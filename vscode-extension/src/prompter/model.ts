import type { PrompterDefinition, ParameterDefinition } from "./types";
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
      result.push(...flattenParameters(parameter.children));
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
      resolvedValues
    );
    const error = validate(slot.parameter, raw, required, allowedValues);

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
