"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildInitialState = buildInitialState;
exports.validateConstraints = validateConstraints;
exports.validate = validate;
const visibilityRules_1 = require("./visibilityRules");
const occurrences_1 = require("./occurrences");
/**
 * 入力欄を持つ末端パラメータを取り出す。group は入れ子になりうるため再帰的に辿る
 * （例: ALCOBJ の OBJ は「要素リストの要素1が修飾名」という2階層構造）。
 */
function flattenParameters(parameters) {
    const result = [];
    for (const parameter of parameters) {
        if (parameter.inputType === "group" &&
            Array.isArray(parameter.children) &&
            parameter.children.length > 0) {
            result.push(...flattenParameters(parameter.children));
        }
        else {
            result.push(parameter);
        }
    }
    return result;
}
/**
 * 入力欄を、繰り返し指定の件数だけ展開して並べる。
 * 2件目以降の入力欄名は `名前#2` のように連番になる（occurrences.ts の規則）。
 */
function expandOccurrences(parameters, values) {
    const result = [];
    for (const parameter of parameters) {
        const count = (0, occurrences_1.isRepeatableGroup)(parameter) ? (0, occurrences_1.countOccurrences)(parameter, values) : 1;
        for (let occurrence = 0; occurrence < count; occurrence += 1) {
            for (const leaf of flattenParameters([parameter])) {
                result.push({
                    parameter: leaf,
                    occurrence,
                    fieldName: (0, occurrences_1.occurrenceName)(leaf.name, occurrence)
                });
            }
        }
    }
    return result;
}
function buildInitialState(definition, initialValues) {
    const slots = expandOccurrences(definition.parameters, initialValues);
    // dependsOn は他パラメータの確定値を参照するため、先に全項目の値を determine する。
    const resolvedValues = {};
    for (const slot of slots) {
        resolvedValues[slot.fieldName] =
            initialValues[slot.fieldName] ??
                // 2件目以降に既定値を勝手に入れると、空のはずの繰り返しが出力されてしまう。
                (slot.occurrence === 0 ? slot.parameter.defaultValue ?? "" : "");
    }
    const fields = slots.map(slot => {
        const raw = resolvedValues[slot.fieldName] ?? "";
        const { visible, required, disabled, allowedValues } = (0, visibilityRules_1.evaluateParameter)(slot.parameter, resolvedValues);
        // 初期表示では「必須なのに空」をエラーにしない。開いた瞬間に赤字が並ぶと
        // 警告として機能しなくなる（実機の F4 も入力前は何も出さない）。
        // 未入力は必須マーク（*）で示し、送信時にクライアント側が検証する。
        const error = raw.trim().length === 0 && required
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
    const constraintErrors = validateConstraints(definition, resolvedValues);
    const hasErrors = fields.some(field => Boolean(field.error)) || constraintErrors.length > 0;
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
function validateConstraints(definition, values) {
    const errors = [];
    const byName = new Map(definition.parameters.map(p => [p.name, p]));
    // 「指定した」とは、既定値のままではないこと。CL の相関はほぼ全ての
    // 対象パラメータが既定値を持つため、値の有無で判定すると常に成立してしまう。
    const isFilled = (name) => {
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
            errors.push(constraint.note ??
                `${constraint.parameters.join(" と ")} は同時に指定できません（指定: ${filled.join(", ")}）。`);
        }
        if (constraint.kind === "together" &&
            filled.length > 0 &&
            filled.length < constraint.parameters.length) {
            const missing = constraint.parameters.filter(name => !isFilled(name));
            errors.push(constraint.note ??
                `${constraint.parameters.join(" と ")} は一緒に指定する必要があります（未指定: ${missing.join(", ")}）。`);
        }
    }
    return errors;
}
function validate(parameter, value, 
// dependsOn 評価後の実効必須。未指定なら定義上の required を使う。
requiredOverride, 
// dependsOn の allowedValues により絞り込まれた許可値。
allowedValues) {
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
    if (parameter.name !== "COMMENT" &&
        !parameter.attributes?.numericOnly &&
        trimmed.length > 0 &&
        charset &&
        (charset === "alpha" || charset === "alnum" || charset === "upper")) {
        if (!/^[A-Za-z0-9_ *\/&.\-'"()#@$]+$/u.test(trimmed)) {
            return "使用できない文字が含まれています。";
        }
    }
    if (parameter.options && parameter.options.length > 0) {
        const allowed = parameter.options.map(option => option.value);
        if (trimmed.length > 0 && !allowed.includes(trimmed)) {
            return "指定できない値です。";
        }
    }
    // 他パラメータの値により選択肢が絞られている場合の相関チェック。
    if (allowedValues && allowedValues.length > 0 && trimmed.length > 0) {
        const permitted = allowedValues.some(value => value.trim().toUpperCase() === trimmed.toUpperCase());
        if (!permitted) {
            return `現在の指定では ${allowedValues.join(" / ")} のみ指定できます。`;
        }
    }
    return undefined;
}
//# sourceMappingURL=model.js.map