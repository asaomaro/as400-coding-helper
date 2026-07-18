import * as vscode from "vscode";
import type { Dialect, LanguageId } from "./types";
import { resolveDialect } from "./dialect";
import { classifyRpgSpecKeyword } from "./specClassifier";

export interface ResolvedPosition {
  readonly language: LanguageId;
  // RPG 固定長のときのみ設定（拡張子＋設定から導出）。cl では undefined。
  readonly dialect?: Dialect;
  readonly document: vscode.TextDocument;
  readonly position: vscode.Position;
  readonly line: number;
  readonly column: number;
  readonly keyword: string;
}

export function resolvePosition(
  document: vscode.TextDocument,
  position: vscode.Position
): ResolvedPosition | undefined {
  const language = getLanguageId(document);
  if (!language) {
    return undefined;
  }

  const line = document.lineAt(position.line);
  const text = line.text;

  if (!text.trim()) {
    return undefined;
  }

  let keyword = "";
  let dialect: Dialect | undefined;

  if (language === "cl") {
    const trimmed = text.trimStart();
    const parts = trimmed.split(/\s+/);
    keyword = (parts[0] ?? "").toUpperCase();
  } else {
    dialect = resolveDialect(document);

    // スペック種別は specClassifier に集約（ruler.ts と共有＝ドリフト防止）。
    // H/F/D/I/O/P/C すべて解決し、C は dialect 依存で新旧判定する。
    // I/O 仕様書は F 仕様書（22 桁目）でプログラム記述/外部記述が決まるため、
    // その行より上の行を渡す。
    const precedingLines: string[] = [];
    for (let above = 0; above < position.line; above += 1) {
      precedingLines.push(document.lineAt(above).text);
    }
    const resolved = classifyRpgSpecKeyword(text, dialect, precedingLines);
    if (!resolved) {
      return undefined;
    }
    keyword = resolved;
  }

  if (!keyword) {
    return undefined;
  }

  return {
    language,
    dialect,
    document,
    position,
    line: position.line,
    column: position.character,
    keyword
  };
}

function getLanguageId(document: vscode.TextDocument): LanguageId | undefined {
  if (document.languageId === "rpg-fixed") {
    return "rpg-fixed";
  }

  if (document.languageId === "cl") {
    return "cl";
  }

  const lower = document.uri.fsPath.toLowerCase();
  if (lower.endsWith(".rpgle")) {
    return "rpg-fixed";
  }

  if (lower.endsWith(".clp")) {
    return "cl";
  }

  return undefined;
}
