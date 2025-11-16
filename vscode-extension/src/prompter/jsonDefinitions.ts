import * as vscode from "vscode";
import type { LanguageId, PrompterDefinition } from "./types";

export class PrompterDefinitionLoader {
  async loadFromUri(uri: vscode.Uri): Promise<PrompterDefinition[]> {
    const document = await vscode.workspace.openTextDocument(uri);
    const raw = document.getText();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Failed to parse prompter definition JSON from ${uri.fsPath}: ${String(
          error
        )}`
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error(
        `Prompter definition file ${uri.fsPath} must contain a JSON array.`
      );
    }

    return parsed as PrompterDefinition[];
  }

  async loadForLanguage(
    language: LanguageId,
    workspaceFolder: vscode.WorkspaceFolder | undefined,
    context: vscode.ExtensionContext
  ): Promise<PrompterDefinition[]> {
    const fileName =
      language === "rpg-fixed"
        ? "rpg-prompter.json"
        : "cl-prompter.json";

    const definitions: PrompterDefinition[] = [];

    // 1) Load default definitions bundled with the extension
    try {
      const defaultUri = vscode.Uri.joinPath(
        context.extensionUri,
        "resources",
        "prompter",
        fileName
      );
      const defaults = await this.loadFromUri(defaultUri);
      definitions.push(...defaults);
    } catch (error) {
      console.log(
        "[rpgClSupport] failed to load default prompter definitions",
        JSON.stringify({
          language,
          fileName,
          error: String(error)
        })
      );
    }

    // 2) Load workspace overrides from .rpg-cl if available
    const baseUri =
      workspaceFolder?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;

    if (!baseUri) {
      return definitions;
    }

    const workspaceUri = vscode.Uri.joinPath(baseUri, ".rpg-cl", fileName);

    try {
      const workspaceDefs = await this.loadFromUri(workspaceUri);

      const byKeyword = new Map<string, PrompterDefinition>();

      for (const def of definitions) {
        byKeyword.set(def.keyword.toUpperCase(), def);
      }

      for (const def of workspaceDefs) {
        byKeyword.set(def.keyword.toUpperCase(), def);
      }

      return Array.from(byKeyword.values());
    } catch (error) {
      // Workspace JSON が無い/壊れている場合は、拡張内デフォルトのみにフォールバックする
      console.log(
        "[rpgClSupport] failed to load workspace prompter definitions",
        JSON.stringify({
          language,
          fileName,
          error: String(error)
        })
      );
      return definitions;
    }
  }
}

