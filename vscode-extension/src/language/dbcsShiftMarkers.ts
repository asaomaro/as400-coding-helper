import * as vscode from "vscode";
import { isInScopeDocument } from "../utils/fileScope";

let shiftOutDecoration: vscode.TextEditorDecorationType | undefined;
let shiftInDecoration: vscode.TextEditorDecorationType | undefined;

function isDbcsCodePoint(codePoint: number): boolean {
  // おおまかに「全角系の文字」を DBCS とみなす
  // - Hiragana, Katakana, CJK, 全角英数・記号など
  if (
    (codePoint >= 0x3040 && codePoint <= 0x30ff) || // Hiragana/Katakana
    (codePoint >= 0x3400 && codePoint <= 0x9fff) || // CJK Unified Ideographs + Ext.A
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
    (codePoint >= 0xff01 && codePoint <= 0xff60) || // Fullwidth ASCII variants
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) // Fullwidth currency etc.
  ) {
    return true;
  }

  return false;
}

export function registerDbcsShiftMarkers(
  context: vscode.ExtensionContext
): void {
  shiftOutDecoration = vscode.window.createTextEditorDecorationType({
    before: {
      contentText: "{"
    }
  });

  shiftInDecoration = vscode.window.createTextEditorDecorationType({
    before: {
      contentText: "}"
    }
  });

  context.subscriptions.push(shiftOutDecoration, shiftInDecoration);

  const updateForEditor = (editor: vscode.TextEditor | undefined): void => {
    if (!editor || !shiftOutDecoration || !shiftInDecoration) {
      return;
    }

    const { document } = editor;

    if (!isInScopeDocument(document)) {
      editor.setDecorations(shiftOutDecoration, []);
      editor.setDecorations(shiftInDecoration, []);
      return;
    }

    const shiftOutRanges: vscode.Range[] = [];
    const shiftInRanges: vscode.Range[] = [];

    for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
      const line = document.lineAt(lineNumber);
      const text = line.text;

      let runStart: number | undefined;
      let index = 0;

      while (index < text.length) {
        const codePoint = text.codePointAt(index);
        if (codePoint === undefined) {
          break;
        }

        const isDbcs = isDbcsCodePoint(codePoint);
        const codeUnitLength = codePoint > 0xffff ? 2 : 1;

        if (isDbcs) {
          if (runStart === undefined) {
            runStart = index;
          }
        } else if (runStart !== undefined) {
          // DBCS 連続範囲の終了
          const runEnd = index;
          const shiftOutPos = new vscode.Position(lineNumber, runStart);
          const shiftInPos = new vscode.Position(lineNumber, runEnd);
          shiftOutRanges.push(new vscode.Range(shiftOutPos, shiftOutPos));
          shiftInRanges.push(new vscode.Range(shiftInPos, shiftInPos));
          runStart = undefined;
        }

        index += codeUnitLength;
      }

      // 行末まで DBCS が続いている場合
      if (runStart !== undefined) {
        const runEnd = text.length;
        const shiftOutPos = new vscode.Position(lineNumber, runStart);
        const shiftInPos = new vscode.Position(lineNumber, runEnd);
        shiftOutRanges.push(new vscode.Range(shiftOutPos, shiftOutPos));
        shiftInRanges.push(new vscode.Range(shiftInPos, shiftInPos));
      }
    }

    editor.setDecorations(shiftOutDecoration, shiftOutRanges);
    editor.setDecorations(shiftInDecoration, shiftInRanges);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      updateForEditor(editor ?? undefined);
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && event.document === activeEditor.document) {
        updateForEditor(activeEditor);
      }
    })
  );

  if (vscode.window.activeTextEditor) {
    updateForEditor(vscode.window.activeTextEditor);
  }
}
