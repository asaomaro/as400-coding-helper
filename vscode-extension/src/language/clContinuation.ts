import * as vscode from "vscode";

export interface LogicalCommandRange {
  readonly range: vscode.Range;
}

export function getLogicalCommandRange(
  document: vscode.TextDocument,
  lineNumber: number
): LogicalCommandRange {
  let start = lineNumber;
  let end = lineNumber;

  for (let line = lineNumber - 1; line >= 0; line -= 1) {
    const text = document.lineAt(line).text;
    if (text.trimEnd().endsWith("+")) {
      start = line;
    } else {
      break;
    }
  }

  for (let line = lineNumber + 1; line < document.lineCount; line += 1) {
    const text = document.lineAt(line).text;
    if (document.lineAt(line - 1).text.trimEnd().endsWith("+")) {
      end = line;
    } else {
      break;
    }
  }

  const startPos = new vscode.Position(start, 0);
  const endLine = document.lineAt(end);
  const endPos = new vscode.Position(end, endLine.text.length);

  return {
    range: new vscode.Range(startPos, endPos)
  };
}

