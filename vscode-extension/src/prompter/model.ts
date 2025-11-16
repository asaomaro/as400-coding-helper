import type { PrompterDefinition, ParameterDefinition } from "./types";

export interface FieldValue {
  readonly parameter: ParameterDefinition;
  readonly value: string;
  readonly error?: string;
}

export interface PrompterState {
  readonly keyword: string;
  readonly fields: FieldValue[];
  readonly hasErrors: boolean;
}

export function buildInitialState(
  definition: PrompterDefinition,
  initialValues: Record<string, string | undefined>
): PrompterState {
  const fields: FieldValue[] = definition.parameters.map(parameter => {
    const raw =
      initialValues[parameter.name] ??
      parameter.defaultValue ??
      "";
    const error = validate(parameter, raw);

    return {
      parameter,
      value: raw,
      error
    };
  });

  const hasErrors = fields.some(field => Boolean(field.error));

  return {
    keyword: definition.keyword,
    fields,
    hasErrors
  };
}

export function validate(
  parameter: ParameterDefinition,
  value: string
): string | undefined {
  const trimmed = value.trim();

  if (parameter.required && trimmed.length === 0) {
    return "A value is required.";
  }

  if (parameter.attributes?.maxLength !== undefined) {
    if (trimmed.length > parameter.attributes.maxLength) {
      return `Value must be at most ${parameter.attributes.maxLength} characters.`;
    }
  }

  if (parameter.attributes?.numericOnly && trimmed.length > 0) {
    if (!/^[0-9]+$/.test(trimmed)) {
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

   // コメント以外の項目については、数値専用でない限り
   // 英数字と空白/アンダースコアのみ許可する。
   if (
     parameter.name !== "COMMENT" &&
     !parameter.attributes?.numericOnly &&
     trimmed.length > 0
   ) {
     if (!/^[A-Za-z0-9_ ]+$/.test(trimmed)) {
       return "Only alphanumeric characters are allowed.";
     }
   }

  if (parameter.options && parameter.options.length > 0) {
    const allowed = parameter.options.map(option => option.value);
    if (trimmed.length > 0 && !allowed.includes(trimmed)) {
      return "Value is not in the allowed set.";
    }
  }

  return undefined;
}
