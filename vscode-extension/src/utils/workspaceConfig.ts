import * as vscode from "vscode";
import type { WorkspaceConfig } from "../prompter/types";

export function getWorkspaceConfig(): WorkspaceConfig {
  const config = vscode.workspace.getConfiguration("rpgClSupport");

  const workspaceFolder =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

  const warningLevel =
    config.get<"info" | "warning" | "error">("warningLevel") ?? "warning";

  const maxLineLength =
    config.get<number | undefined>("maxLineLength") ?? undefined;

  const rpgSpecPath =
    config.get<string>("jsonDefinitionPaths.rpgSpecPath") ??
    ".rpg-cl/rpg-prompter.json";

  const clCommandsPath =
    config.get<string>("jsonDefinitionPaths.clCommandsPath") ??
    ".rpg-cl/cl-prompter.json";

  return {
    workspaceRoot: workspaceFolder,
    rules: {
      warningLevel,
      maxLineLength
    },
    jsonDefinitionPaths: {
      rpgSpecPath,
      clCommandsPath
    }
  };
}
