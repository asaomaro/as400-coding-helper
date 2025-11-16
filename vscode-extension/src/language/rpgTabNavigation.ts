import * as vscode from "vscode";
import { getNextTabStop } from "./rpgLayout";
import { isEditAllowedRange } from "./rpgEditGuards";

export function registerRpgTabNavigation(
  context: vscode.ExtensionContext
): void {
  const disposable = vscode.commands.registerCommand(
    "rpgClSupport.rpgTabNext",
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const { document } = editor;
      if (document.languageId !== "rpg-fixed") {
        return;
      }

      const position = editor.selection.active;
      const nextStop = getNextTabStop(position.character);
      if (nextStop === undefined) {
        return;
      }

      const line = document.lineAt(position.line);
      const edits: vscode.TextEdit[] = [];

      if (line.text.length < nextStop) {
        const paddingLength = nextStop - line.text.length;
        const padding = " ".repeat(paddingLength);
        const insertPosition = new vscode.Position(
          line.lineNumber,
          line.text.length
        );
        const range = new vscode.Range(insertPosition, insertPosition);

        if (isEditAllowedRange(document, range)) {
          edits.push(vscode.TextEdit.insert(insertPosition, padding));
        }
      }

      const newCursorPosition = new vscode.Position(position.line, nextStop);
      editor.selections = [
        new vscode.Selection(newCursorPosition, newCursorPosition)
      ];

      if (edits.length > 0) {
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.set(document.uri, edits);
        void vscode.workspace.applyEdit(workspaceEdit);
      }
    }
  );

  context.subscriptions.push(disposable);
}

