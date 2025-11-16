import * as vscode from "vscode";
import type { ParameterDefinition, PrompterDefinition } from "./types";

export function showParameterHelp(
  definition: PrompterDefinition,
  parameter: ParameterDefinition
): void {
  const helpText = parameter.help?.trim() || parameter.description;
  const message = `${definition.keyword} - ${parameter.name}: ${helpText}`;
  void vscode.window.showInformationMessage(message);
}

