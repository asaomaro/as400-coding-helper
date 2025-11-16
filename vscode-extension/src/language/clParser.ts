import * as vscode from "vscode";

export function parseClDocument(
  document: vscode.TextDocument
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];

  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
    const line = document.lineAt(lineNumber);
    const text = line.text;

    const singleQuotes = (text.match(/'/g) ?? []).length;
    if (singleQuotes % 2 === 1) {
      const range = new vscode.Range(
        new vscode.Position(lineNumber, 0),
        new vscode.Position(lineNumber, text.length)
      );
      diagnostics.push(
        new vscode.Diagnostic(
          range,
          "Unmatched single quote in CL command line.",
          vscode.DiagnosticSeverity.Warning
        )
      );
    }

    const doubleQuotes = (text.match(/"/g) ?? []).length;
    if (doubleQuotes % 2 === 1) {
      const range = new vscode.Range(
        new vscode.Position(lineNumber, 0),
        new vscode.Position(lineNumber, text.length)
      );
      diagnostics.push(
        new vscode.Diagnostic(
          range,
          "Unmatched double quote in CL command line.",
          vscode.DiagnosticSeverity.Warning
        )
      );
    }
  }

  return diagnostics;
}

