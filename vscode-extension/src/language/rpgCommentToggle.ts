import * as vscode from "vscode";
import { isEditAllowedRange } from "./rpgEditGuards";

export function registerRpgCommentToggle(
  context: vscode.ExtensionContext
): void {
  const disposable = vscode.commands.registerCommand(
    "rpgClSupport.toggleComment.rpg",
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const { document } = editor;
      if (document.languageId !== "rpg-fixed") {
        return;
      }

      const targetLines = collectTargetLines(editor);
      if (targetLines.length === 0) {
        return;
      }

      void editor.edit(editBuilder => {
        for (const lineNumber of targetLines) {
          const line = document.lineAt(lineNumber);
          const originalText = line.text;
          const base = originalText.padEnd(7, " ");
          const marker = base.charAt(6);
          const isCommented = marker === "*";
          const replacementChar = isCommented ? " " : "*";
          const newText =
            base.substring(0, 6) +
            replacementChar +
            base.substring(7, base.length);

          const range = new vscode.Range(
            new vscode.Position(lineNumber, 0),
            new vscode.Position(lineNumber, originalText.length)
          );

          if (!isEditAllowedRange(document, range)) {
            continue;
          }

          editBuilder.replace(range, newText);
        }
      });
    }
  );

  context.subscriptions.push(disposable);
}

function collectTargetLines(editor: vscode.TextEditor): number[] {
  const lines = new Set<number>();

  for (const selection of editor.selections) {
    const start = selection.start.line;
    const end = selection.end.line;
    for (let line = start; line <= end; line += 1) {
      lines.add(line);
    }
  }

  if (lines.size === 0) {
    lines.add(editor.selection.active.line);
  }

  return [...lines].sort((a, b) => a - b);
}
