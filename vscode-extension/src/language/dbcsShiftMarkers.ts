import * as vscode from "vscode";
// 全角の判定は core と共有する（帳票プレビューと食い違わせないため）。
import { isDbcsCodePoint } from "../core/dbcs";
import { isInScopeDocument } from "../utils/fileScope";

/** 表示の状態。ステータスバーのクリックで切り替える。 */
const STATE_KEY = "rpgClSupport.sosi.enabled";
let enabled = true;
let statusBarItem: vscode.StatusBarItem | undefined;

let shiftOutDecoration: vscode.TextEditorDecorationType | undefined;
let shiftInDecoration: vscode.TextEditorDecorationType | undefined;


export function registerDbcsShiftMarkers(
  context: vscode.ExtensionContext
): void {
  shiftOutDecoration = vscode.window.createTextEditorDecorationType({
    before: {
      contentText: "{",
      color: new vscode.ThemeColor("editorCodeLens.foreground")
    }
  });

  shiftInDecoration = vscode.window.createTextEditorDecorationType({
    before: {
      contentText: "}",
      color: new vscode.ThemeColor("editorCodeLens.foreground")
    }
  });

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99
  );
  statusBarItem.command = "rpgClSupport.sosi.toggle";

  enabled = context.workspaceState.get<boolean>(STATE_KEY) ?? true;

  context.subscriptions.push(shiftOutDecoration, shiftInDecoration, statusBarItem);

  const updateForEditor = (editor: vscode.TextEditor | undefined): void => {
    if (!editor || !shiftOutDecoration || !shiftInDecoration) {
      return;
    }

    const { document } = editor;

    if (!isInScopeDocument(document)) {
      editor.setDecorations(shiftOutDecoration, []);
      editor.setDecorations(shiftInDecoration, []);
      statusBarItem?.hide();
      return;
    }

    updateStatusBar();
    statusBarItem?.show();

    // 消しているときは装飾を外す。桁は SO/SI の分だけ変わるので、
    // 出す・出さないで見え方が変わるのが正しい（実機は SO/SI が実在する）。
    if (!enabled) {
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

  const toggleCommand = vscode.commands.registerCommand(
    "rpgClSupport.sosi.toggle",
    async () => {
      enabled = !enabled;
      await context.workspaceState.update(STATE_KEY, enabled);
      updateForEditor(vscode.window.activeTextEditor);
    }
  );

  context.subscriptions.push(
    toggleCommand,
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

function updateStatusBar(): void {
  if (!statusBarItem) {
    return;
  }
  statusBarItem.text = `$(symbol-text) SOSI: ${enabled ? "On" : "Off"}`;
  statusBarItem.tooltip = enabled
    ? "DBCS の前後に { } を表示しています。クリックで消す"
    : "DBCS の { } を表示していません。クリックで出す";
}
