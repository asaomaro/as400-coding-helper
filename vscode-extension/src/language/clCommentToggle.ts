import * as vscode from "vscode";

export function registerClCommentToggle(
  context: vscode.ExtensionContext
): void {
  const disposable = vscode.commands.registerCommand(
    "rpgClSupport.toggleComment.cl",
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const { document } = editor;
      if (document.languageId !== "cl") {
        return;
      }

      const targetLines = collectTargetLines(editor);
      if (targetLines.length === 0) {
        return;
      }

      const allCommented = targetLines.every(lineNumber => {
        const text = document.lineAt(lineNumber).text;
        const trimmed = text.trimStart();
        return trimmed.startsWith("/*");
      });

      void editor.edit(editBuilder => {
        for (const lineNumber of targetLines) {
          const line = document.lineAt(lineNumber);
          const originalText = line.text;
          const match = originalText.match(/^(\s*)/);
          const leading = match ? match[1] : "";
          const body = originalText.slice(leading.length);

          let newText: string;
          if (allCommented) {
            if (body.startsWith("/* ")) {
              newText = leading + body.slice(3);
            } else if (body.startsWith("/*")) {
              newText = leading + body.slice(2);
            } else {
              newText = originalText;
            }
          } else {
            newText = `${leading}/* ${body}`;
          }

          const range = new vscode.Range(
            new vscode.Position(lineNumber, 0),
            new vscode.Position(lineNumber, originalText.length)
          );

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

