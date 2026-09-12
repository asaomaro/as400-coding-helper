import * as vscode from "vscode";
import { findColorSegments, type SeuBaseColor } from "../sync/visibleColorMarkers";
import { isInScopeDocument } from "../utils/fileScope";

const COLOR_VALUES: Record<SeuBaseColor, string> = {
  green: "#3fb950",
  white: "#e6edf3",
  red: "#ff7b72",
  turquoise: "#39c5cf",
  yellow: "#e3b341",
  pink: "#f778ba",
  blue: "#58a6ff"
};

export function registerSeuColorMarkers(context: vscode.ExtensionContext): void {
  const decorations = new Map<SeuBaseColor, vscode.TextEditorDecorationType>();
  for (const [color, value] of Object.entries(COLOR_VALUES) as [SeuBaseColor, string][]) {
    decorations.set(color, vscode.window.createTextEditorDecorationType({ color: value }));
  }
  context.subscriptions.push(...decorations.values());

  const clear = (editor: vscode.TextEditor): void => {
    for (const decoration of decorations.values()) editor.setDecorations(decoration, []);
  };
  const update = (editor: vscode.TextEditor | undefined): void => {
    if (!editor) return;
    const enabled = vscode.workspace.getConfiguration("rpgClSupport.seuColors").get<boolean>("enabled", true);
    if (!enabled || !isInScopeDocument(editor.document)) {
      clear(editor);
      return;
    }
    const ranges = new Map<SeuBaseColor, vscode.Range[]>();
    for (const color of Object.keys(COLOR_VALUES) as SeuBaseColor[]) ranges.set(color, []);
    for (const segment of findColorSegments(Array.from({ length: editor.document.lineCount }, (_, line) => editor.document.lineAt(line).text))) {
      ranges.get(segment.color)!.push(new vscode.Range(segment.range.line, segment.range.start, segment.range.line, segment.range.end));
    }
    for (const [color, decoration] of decorations) editor.setDecorations(decoration, ranges.get(color)!);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(update),
    vscode.workspace.onDidChangeTextDocument(event => {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document === event.document) update(editor);
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("rpgClSupport.seuColors.enabled")) update(vscode.window.activeTextEditor);
    })
  );
  update(vscode.window.activeTextEditor);
}
