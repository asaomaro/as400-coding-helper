import type { ParameterDefinition } from "./types";

export function isParameterVisible(
  definition: ParameterDefinition,
  hasExistingValue: boolean
): boolean {
  if (hasExistingValue) {
    return true;
  }

  if (definition.visibleByDefault === false) {
    return false;
  }

  return true;
}

