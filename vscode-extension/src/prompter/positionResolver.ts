import * as vscode from "vscode";
import type { Dialect, LanguageId } from "./types";
import { resolveDialect } from "./dialect";
import { classifyRpgSpecKeyword } from "./specClassifier";
import { getLogicalCommandRange } from "../language/clContinuation";
import { joinContinuationLines, parseClCommand } from "./clCommandParser";
import { resolveDdsType, resolveSourceKind } from "../core/sourceKind";

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
  // CL は継続行(+/-)で複数行に跨る。カーソルがどの行にあっても、
  // コマンドは論理行の先頭にしか無い。行頭の語をそのまま採ると、
  // 継続行では SRCFILE(...) のような引数を命令名と見なしてしまう。
  let commandLine = position.line;

  if (language === "dds") {
    // 注記行（7 桁目が *）は 8-80 桁が本文なので桁の意味が無い。
    if (text.length > 6 && text.charAt(6) === "*") {
      return undefined;
    }
    keyword = resolveDdsType(document.uri.fsPath) ?? "";
  } else if (language === "cl" || language === "cmd") {
    const logical = getLogicalCommandRange(document, position.line).range;
    commandLine = logical.start.line;

    const lines: string[] = [];
    for (let line = logical.start.line; line <= logical.end.line; line += 1) {
      lines.push(document.lineAt(line).text);
    }

    // ラベル(`TAG1:`)やコメントの扱いは解析器に任せる（書き戻しと同じ経路）。
    const parsed = parseClCommand(joinContinuationLines(lines));
    keyword = parsed?.keyword ?? "";
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
    line: commandLine,
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

  // 拡張子による判定は core/sourceKind に一本化してある
  // （lint core と同じ判定を使う。写しを作るとドリフトする）。
  return resolveSourceKind(document.uri.fsPath)?.language;
}
