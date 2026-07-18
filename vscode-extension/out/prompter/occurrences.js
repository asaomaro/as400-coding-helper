"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OCCURRENCE_SEPARATOR = void 0;
exports.occurrenceName = occurrenceName;
exports.isRepeatableGroup = isRepeatableGroup;
exports.collectLeaves = collectLeaves;
exports.countOccurrences = countOccurrences;
/**
 * 繰り返し指定（`OBJ((A ...) (B ...))`）の入力欄名の付け方。
 *
 * 1件目は素の名前、2件目以降は `名前#2` のように連番を付ける。
 * 1件目に連番を付けないのは、繰り返しを使わない大多数の定義と
 * 入力欄名を揃えるため（既存の値・dependsOn の参照が壊れない）。
 */
exports.OCCURRENCE_SEPARATOR = "#";
function occurrenceName(base, index) {
    return index <= 0 ? base : `${base}${exports.OCCURRENCE_SEPARATOR}${index + 1}`;
}
function isRepeatableGroup(parameter) {
    return (parameter.inputType === "group" &&
        Boolean(parameter.children?.length) &&
        typeof parameter.maxOccurrences === "number" &&
        parameter.maxOccurrences > 1);
}
/** group の末端入力欄を、入れ子を辿って集める。 */
function collectLeaves(parameters) {
    return parameters.flatMap(parameter => parameter.inputType === "group" && parameter.children?.length
        ? collectLeaves(parameter.children)
        : [parameter]);
}
/**
 * 値の中に何件分の繰り返しが入っているかを数える。最低1件。
 * 上限は定義の maxOccurrences で抑える。
 */
function countOccurrences(parameter, values) {
    if (!isRepeatableGroup(parameter)) {
        return 1;
    }
    const leaves = collectLeaves(parameter.children ?? []);
    const limit = parameter.maxOccurrences ?? 1;
    let count = 1;
    for (let index = 1; index < limit; index += 1) {
        const filled = leaves.some(leaf => {
            const value = values[occurrenceName(leaf.name, index)];
            const text = Array.isArray(value) ? value[0] ?? "" : value ?? "";
            return text.trim().length > 0;
        });
        if (!filled) {
            break;
        }
        count = index + 1;
    }
    return count;
}
//# sourceMappingURL=occurrences.js.map