import * as vscode from "vscode";
import type { Dialect, LanguageId, PrompterDefinition } from "./types";

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
    dialect: Dialect | undefined,
    workspaceFolder: vscode.WorkspaceFolder | undefined,
    context: vscode.ExtensionContext
  ): Promise<PrompterDefinition[]> {
    // RPG は方言別サブディレクトリ rpg/{dialect}/ を使う。CL は従来どおり cl/。
    const subPath =
      language === "rpg-fixed" ? ["rpg", dialect ?? "ile"] : ["cl"];

    // 1) Load default definitions bundled with the extension
    const defaultDirUri = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "prompter",
      ...subPath
    );
    const definitions = await this.loadFromDirectory(defaultDirUri);

    if (definitions.length === 0) {
      console.log(
        "[rpgClSupport] no default prompter definitions found",
        JSON.stringify({ language, dialect, subPath: subPath.join("/") })
      );
    }

    // 2) Load workspace overrides from .rpg-cl/{subPath}/ if available
    const baseUri =
      workspaceFolder?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;

    if (!baseUri) {
      return definitions;
    }

    // 上書き層を低→高優先で重ねる。
    // - ile のみ: 旧 .rpg-cl/rpg/（dialect 無し）も後方互換で読む（既定移設前のユーザー上書き互換）。
    // - 全方言/CL: .rpg-cl/{subPath}/ を読む（高優先）。
    const overrideDirs: vscode.Uri[] = [];
    if (language === "rpg-fixed" && (dialect ?? "ile") === "ile") {
      overrideDirs.push(vscode.Uri.joinPath(baseUri, ".rpg-cl", "rpg"));
    }
    overrideDirs.push(vscode.Uri.joinPath(baseUri, ".rpg-cl", ...subPath));

    const byKeyword = new Map<string, PrompterDefinition>();
    for (const def of definitions) {
      byKeyword.set(def.keyword.toUpperCase(), def);
    }

    let hasOverride = false;
    for (const dirUri of overrideDirs) {
      const overrideDefs = await this.loadFromDirectory(dirUri);
      for (const def of overrideDefs) {
        byKeyword.set(def.keyword.toUpperCase(), def);
        hasOverride = true;
      }
    }

    if (!hasOverride) {
      return definitions;
    }

    return Array.from(byKeyword.values());
  }
}
