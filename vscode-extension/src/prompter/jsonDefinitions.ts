import * as vscode from "vscode";
import type { LanguageId, PrompterDefinition } from "./types";

export class PrompterDefinitionLoader {
  private async loadDefinitionFromUri(uri: vscode.Uri): Promise<PrompterDefinition> {
    const document = await vscode.workspace.openTextDocument(uri);
    const raw = document.getText();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Failed to parse prompter definition JSON from ${uri.fsPath}: ${String(error)}`
      );
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(
        `Prompter definition file ${uri.fsPath} must contain a JSON object.`
      );
    }

    return parsed as PrompterDefinition;
  }

  private async loadFromDirectory(dirUri: vscode.Uri): Promise<PrompterDefinition[]> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
      return [];
    }

    const definitions: PrompterDefinition[] = [];
    for (const [name, type] of entries) {
      if (type === vscode.FileType.File && name.endsWith(".json")) {
        const fileUri = vscode.Uri.joinPath(dirUri, name);
        try {
          const def = await this.loadDefinitionFromUri(fileUri);
          definitions.push(def);
        } catch (error) {
          console.log(
            "[rpgClSupport] failed to load prompter definition",
            JSON.stringify({ file: name, error: String(error) })
          );
        }
      }
    }
    return definitions;
  }

  async loadForLanguage(
    language: LanguageId,
    workspaceFolder: vscode.WorkspaceFolder | undefined,
    context: vscode.ExtensionContext
  ): Promise<PrompterDefinition[]> {
    const subDir = language === "rpg-fixed" ? "rpg" : "cl";

    // 1) Load default definitions bundled with the extension
    const defaultDirUri = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "prompter",
      subDir
    );
    const definitions = await this.loadFromDirectory(defaultDirUri);

    if (definitions.length === 0) {
      console.log(
        "[rpgClSupport] no default prompter definitions found",
        JSON.stringify({ language, subDir })
      );
    }

    // 2) Load workspace overrides from .rpg-cl/{subDir}/ if available
    const baseUri =
      workspaceFolder?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;

    if (!baseUri) {
      return definitions;
    }

    const workspaceDirUri = vscode.Uri.joinPath(baseUri, ".rpg-cl", subDir);
    const workspaceDefs = await this.loadFromDirectory(workspaceDirUri);

    if (workspaceDefs.length === 0) {
      return definitions;
    }

    const byKeyword = new Map<string, PrompterDefinition>();
    for (const def of definitions) {
      byKeyword.set(def.keyword.toUpperCase(), def);
    }
    for (const def of workspaceDefs) {
      byKeyword.set(def.keyword.toUpperCase(), def);
    }
    return Array.from(byKeyword.values());
  }
}
