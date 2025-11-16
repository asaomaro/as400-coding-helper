import * as vscode from "vscode";

export function isEditAllowedRange(
  _document: vscode.TextDocument,
  range: vscode.Range
): boolean {
  const startLine = range.start.line;
  const endLine = range.end.line;

  for (let line = startLine; line <= endLine; line += 1) {
    if (line === 3) {
      const startCol = line === startLine ? range.start.character : 0;
      if (startCol < 6) {
        return false;
      }
    }
  }

  return true;
}

