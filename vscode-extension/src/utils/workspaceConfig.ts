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

  const rpgSpecDir =
    config.get<string>("jsonDefinitionPaths.rpgSpecDir") ??
    ".rpg-cl/rpg";

  const clCommandsDir =
    config.get<string>("jsonDefinitionPaths.clCommandsDir") ??
    ".rpg-cl/cl";

  return {
    workspaceRoot: workspaceFolder,
    rules: {
      warningLevel,
      maxLineLength
    },
    jsonDefinitionPaths: {
      rpgSpecDir,
      clCommandsDir
    }
  };
}
