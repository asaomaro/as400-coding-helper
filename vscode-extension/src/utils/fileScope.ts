import * as vscode from "vscode";

/**
 * ルーラー表示・制御コード(SOSI)表示などの入力補助機能の対象とする拡張子。
 * 先頭ドットなし・小文字で定義する（AGENTS.md の指定に一致）。
 */
export const TARGET_EXTENSIONS = [
  "rpg",
  "rpgle",
  "clp",
  "dds",
  "dspf",
  "prtf",
  "cmd",
] as const;

const TARGET_LANGUAGE_IDS = ["rpg-fixed", "cl"];

function hasTargetExtension(fsPath: string): boolean {
  const lower = fsPath.toLowerCase();
  return TARGET_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`));
}

export function isInScopeDocument(document: vscode.TextDocument): boolean {
  if (TARGET_LANGUAGE_IDS.includes(document.languageId)) {
    return true;
  }

  return hasTargetExtension(document.uri.fsPath);
}

export function isInScopeUri(uri: vscode.Uri): boolean {
  return hasTargetExtension(uri.fsPath);
}
