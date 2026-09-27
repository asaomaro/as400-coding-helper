import * as vscode from "vscode";
import { PrompterDefinitionLoader } from "../../prompter/jsonDefinitions";
import { resolvePosition } from "../../prompter/positionResolver";
import { openPrompter } from "../../prompter/webview";
import { applyChanges } from "../../prompter/applyChanges";
import { extractInitialValues } from "../../prompter/initialValues";
import { resolveDialect } from "../../prompter/dialect";
import { resolveDefinitionLanguage } from "../../prompter/jsonDefinitions";
import type { ResolvedPosition } from "../../prompter/positionResolver";
import type { PrompterDefinition } from "../../prompter/types";
import {
  DATA_AREA_KEYWORD,
  PROMPT_TYPE_PARAMETER,
  dataAreaDefinition,
  keywordForPromptType,
  promptTypeOf,
  withPromptType
} from "../../prompter/promptTypes";

export function registerShowPrompterCommand(
  context: vscode.ExtensionContext
): void {
  const disposable = vscode.commands.registerCommand(
    "rpgClSupport.showPrompter",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const { document, selection } = editor;
      console.log(
        "[rpgClSupport] showPrompter invoked",
        JSON.stringify({
          uri: document.uri.toString(),
          languageId: document.languageId,
          line: selection.active.line,
          character: selection.active.character
        })
      );
      const originalSelection = new vscode.Selection(
        selection.start,
        selection.end
      );

      const resolvedLine = document.lineAt(selection.active.line);
      const lineText = resolvedLine.text;

      const isRpgFixed =
        document.languageId === "rpg-fixed" ||
        document.uri.fsPath.toLowerCase().endsWith(".rpgle");

      if (isRpgFixed) {
        const padded = lineText.padEnd(7, " ");
        const commentMarker = padded.charAt(6);
        if (commentMarker === "*") {
          void vscode.window.showInformationMessage(
            "コメント行では F4 プロンプターを表示できません。"
          );
          return;
        }
      }

      let resolved = resolvePosition(document, selection.active);

      // **RPG は ACS と同じくプロンプト・タイプで開く**（空行はデータ域 `**`。実操作調査の P15・利用者の決定）。
      if (isRpgFixed) {
        resolved ??= {
          language: "rpg-fixed",
          dialect: resolveDialect(document),
          document,
          position: selection.active,
          line: selection.active.line,
          column: selection.active.character,
          keyword: DATA_AREA_KEYWORD
        };
        await runRpgPrompter(context, editor, resolved, originalSelection);
        return;
      }

      if (!resolved) {
        void vscode.window.showInformationMessage(
          "F4 prompter is only available for RPG/CL commands."
        );
        return;
      }

      const loader = new PrompterDefinitionLoader();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      // キーワードで 1 件だけ読む。全件読むと CL では 134 ファイル・3.5MB になり、
      // F4 の表示がそのぶん待たされる。
      const definition = await loader.loadDefinition(
        resolved.keyword,
        resolved.language,
        resolved.dialect,
        workspaceFolder,
        context
      );

      if (!definition) {
        void vscode.window.showInformationMessage(
          `No prompter definition found for ${resolved.keyword}.`
        );
        editor.selection = originalSelection;
        return;
      }

      console.log(
        "[rpgClSupport] using definition",
        JSON.stringify({
          keyword: definition.keyword,
          parameterNames: definition.parameters.map(parameter => parameter.name),
          hasColumns: definition.parameters.some(
            parameter =>
              typeof parameter.sourceStart === "number" &&
              typeof parameter.sourceLength === "number"
          )
        })
      );

      const initialValues = extractInitialValues(resolved, definition);
      const result = await openPrompter(
        context,
        definition,
        resolved,
        initialValues
      );

      if (!result || !result.confirmed) {
        console.log(
          "[rpgClSupport] prompter cancelled or closed",
          JSON.stringify({ confirmed: result?.confirmed ?? false })
        );

        await vscode.window.showTextDocument(editor.document, {
          viewColumn: editor.viewColumn,
          selection: originalSelection
        });
        return;
      }

      const targetEditor =
        vscode.window.visibleTextEditors.find(
          e => e.document.uri.toString() === document.uri.toString()
        ) ?? editor;

      if (targetEditor.document.isClosed) {
        console.log(
          "[rpgClSupport] target editor is closed; skipping applyChanges",
          JSON.stringify({ uri: targetEditor.document.uri.toString() })
        );
        await vscode.window.showTextDocument(editor.document, {
          viewColumn: editor.viewColumn,
          selection: originalSelection
        });
        return;
      }

      console.log(
        "[rpgClSupport] applyChanges request",
        JSON.stringify({
          line: resolved.line,
          keyword: definition.keyword,
          values: result.values
        })
      );

      await applyChanges(targetEditor, definition, resolved, result.values);

      await vscode.window.showTextDocument(targetEditor.document, {
        viewColumn: targetEditor.viewColumn,
        selection: originalSelection
      });
    }
  );

  context.subscriptions.push(disposable);
}

/**
 * RPG のプロンプター。**プロンプト・タイプを変えて OK すると、書かずにその仕様書のプロンプトで開き直す**（ACS と同じ）。
 * データ域（`**`）は行をそのまま書く。仕様書のプロンプトで 6 桁目が空の行に書くときは仕様書の文字を置く。
 */
async function runRpgPrompter(
  context: vscode.ExtensionContext,
  editor: vscode.TextEditor,
  first: ResolvedPosition,
  originalSelection: vscode.Selection
): Promise<void> {
  const document = editor.document;
  const lang = resolveDefinitionLanguage();
  const loader = new PrompterDefinitionLoader();
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const restore = async (): Promise<void> => {
    await vscode.window.showTextDocument(document, { viewColumn: editor.viewColumn, selection: originalSelection });
  };

  let keyword = first.keyword;
  for (let hop = 0; hop < 10; hop += 1) {
    const resolved: ResolvedPosition = { ...first, keyword };
    const lineText = document.lineAt(resolved.line).text;
    let definition: PrompterDefinition | undefined;
    let initialValues: Record<string, string>;
    if (keyword === DATA_AREA_KEYWORD) {
      definition = dataAreaDefinition(lang);
      initialValues = { DATA: lineText };
    } else {
      definition = await loader.loadDefinition(keyword, resolved.language, resolved.dialect, workspaceFolder, context);
      if (!definition) {
        void vscode.window.showInformationMessage(`No prompter definition found for ${keyword}.`);
        await restore();
        return;
      }
      initialValues = extractInitialValues(resolved, definition);
    }

    const type = promptTypeOf(keyword);
    const result = await openPrompter(context, withPromptType(definition, lang), resolved, {
      ...initialValues,
      [PROMPT_TYPE_PARAMETER]: type
    });
    if (!result || !result.confirmed) {
      await restore();
      return;
    }

    const raw = result.values[PROMPT_TYPE_PARAMETER];
    const chosen = (Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").toString().trim().toUpperCase() || type;
    if (chosen !== type) {
      const preceding: string[] = [];
      for (let line = 0; line < resolved.line; line += 1) preceding.push(document.lineAt(line).text);
      const next = keywordForPromptType(chosen, lineText, resolved.dialect, preceding);
      if (next === undefined) {
        void vscode.window.showWarningMessage(`プロンプト・タイプ ${chosen} は使えません。`);
      } else {
        keyword = next;
      }
      continue; // 書かずに開き直す（ACS と同じ）
    }

    const values = { ...result.values };
    delete values[PROMPT_TYPE_PARAMETER];
    const target =
      vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === document.uri.toString()) ?? editor;
    if (target.document.isClosed) {
      await restore();
      return;
    }

    if (keyword === DATA_AREA_KEYWORD) {
      // データ域は行をそのまま書く（trim しない。行末の空白だけ落とす）。
      const data = (Array.isArray(values.DATA) ? values.DATA[0] ?? "" : values.DATA ?? "").toString().replace(/\s+$/u, "");
      const line = target.document.lineAt(resolved.line);
      await target.edit(builder => builder.replace(line.range, data));
    } else {
      await applyChanges(target, definition, { ...resolved, specLetter: type === "CX" ? "C" : type }, values);
    }
    await restore();
    return;
  }
}
