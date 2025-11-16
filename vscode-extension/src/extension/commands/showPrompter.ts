import * as vscode from "vscode";
import { PrompterDefinitionLoader } from "../../prompter/jsonDefinitions";
import { resolvePosition } from "../../prompter/positionResolver";
import { openPrompter } from "../../prompter/webview";
import { applyChanges } from "../../prompter/applyChanges";
import { extractInitialValues } from "../../prompter/initialValues";

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

      const resolved = resolvePosition(document, selection.active);

      if (!resolved) {
        void vscode.window.showInformationMessage(
          "F4 prompter is only available for RPG/CL commands."
        );
        return;
      }

      const loader = new PrompterDefinitionLoader();
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      const definitions = await loader.loadForLanguage(
        resolved.language,
        workspaceFolder,
        context
      );
      console.log(
        "[rpgClSupport] loaded definitions",
        JSON.stringify({
          language: resolved.language,
          count: definitions.length,
          keywords: definitions.map(def => def.keyword)
        })
      );

      const definition = definitions.find(
        candidate => candidate.keyword === resolved.keyword
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

      console.log(
        "[rpgClSupport] applyChanges request",
        JSON.stringify({
          line: resolved.line,
          keyword: definition.keyword,
          values: result.values
        })
      );

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
