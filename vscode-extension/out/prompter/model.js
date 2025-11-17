"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildInitialState = buildInitialState;
exports.validate = validate;
function flattenParameters(parameters) {
    const result = [];
    for (const parameter of parameters) {
        if (parameter.inputType === "group" &&
            Array.isArray(parameter.children) &&
            parameter.children.length > 0) {
            for (const child of parameter.children) {
                result.push(child);
            }
        }
        else {
            result.push(parameter);
        }
    }
    return result;
}
function buildInitialState(definition, initialValues) {
    const flatParameters = flattenParameters(definition.parameters);
    const fields = flatParameters.map(parameter => {
        const raw = initialValues[parameter.name] ??
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
function validate(parameter, value) {
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
    if (parameter.name !== "COMMENT" &&
        !parameter.attributes?.numericOnly &&
        trimmed.length > 0 &&
        charset &&
        (charset === "alpha" || charset === "alnum" || charset === "upper")) {
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
    return undefined;
}
//# sourceMappingURL=model.js.map