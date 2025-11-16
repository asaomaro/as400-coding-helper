import * as vscode from "vscode";

const RPG_TAB_STOPS: readonly number[] = [6, 10, 20, 30, 40, 50, 60, 70];

export function getNextTabStop(column: number): number | undefined {
  return RPG_TAB_STOPS.find(stop => stop > column);
}

export function getLine(document: vscode.TextDocument, line: number): vscode.TextLine {
  return document.lineAt(line);
}

