import * as vscode from "vscode";

function isSupportedDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "rpg-fixed" || document.languageId === "cl";
}

export function registerFixedFormatNavigation(
  _context: vscode.ExtensionContext
): void {
  // 固定長フォーマット用のカーソル移動および
  // 矢印キーに連動したスペース挿入ロジックは廃止しました。
  //
  // 将来的に必要になった場合は、この関数内で
  // onDidChangeTextEditorSelection などのハンドラを
  // 再度登録してください。
  void vscode; // import を使用済みにして ESLint/tsc の警告を防ぐ
}

