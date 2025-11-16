import * as vscode from "vscode";

export function isInScopeDocument(document: vscode.TextDocument): boolean {
  if (document.languageId === "rpg-fixed" || document.languageId === "cl") {
    return true;
  }

  const lower = document.uri.fsPath.toLowerCase();
  return lower.endsWith(".rpgle") || lower.endsWith(".clp");
}

export function isInScopeUri(uri: vscode.Uri): boolean {
  const lower = uri.fsPath.toLowerCase();
  return lower.endsWith(".rpgle") || lower.endsWith(".clp");
}

