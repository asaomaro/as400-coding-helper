import type { ParameterDefinition } from "./types";

/**
 * 繰り返し指定（`OBJ((A ...) (B ...))`）の入力欄名の付け方。
 *
 * 1件目は素の名前、2件目以降は `名前#2` のように連番を付ける。
 * 1件目に連番を付けないのは、繰り返しを使わない大多数の定義と
 * 入力欄名を揃えるため（既存の値・dependsOn の参照が壊れない）。
 */
export const OCCURRENCE_SEPARATOR = "#";

export function occurrenceName(base: string, index: number): string {
  return index <= 0 ? base : `${base}${OCCURRENCE_SEPARATOR}${index + 1}`;
}

export function isRepeatableGroup(parameter: ParameterDefinition): boolean {
  return (
    parameter.inputType === "group" &&
    Boolean(parameter.children?.length) &&
    typeof parameter.maxOccurrences === "number" &&
    parameter.maxOccurrences > 1
  );
}

/** group の末端入力欄を、入れ子を辿って集める。 */
export function collectLeaves(
  parameters: readonly ParameterDefinition[]
): ParameterDefinition[] {
  return parameters.flatMap(parameter =>
    parameter.inputType === "group" && parameter.children?.length
      ? collectLeaves(parameter.children)
      : [parameter]
  );
}

/**
 * 値の中に何件分の繰り返しが入っているかを数える。最低1件。
 * 上限は定義の maxOccurrences で抑える。
 */
export function countOccurrences(
  parameter: ParameterDefinition,
  values: Record<string, string | string[] | undefined>
): number {
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
