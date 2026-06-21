import * as vscode from "vscode";
import type { Dialect, LanguageId } from "./types";
import { resolveDialect } from "./dialect";

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

    const specCharRaw = text.length > 5 ? text.charAt(5) : " ";
    const specChar = specCharRaw.toUpperCase();

    if (specChar === "D") {
      keyword = "D-SPEC";
    } else if (specChar === "C") {
      // RPG III(rpg3) には C-NEW(自由形演算) が存在しないため常に C-SPEC。
      // ILE(ile) のみ従来どおり opcode で C-NEW を判定する。
      if (dialect === "rpg3") {
        keyword = "C-SPEC";
      } else {
        const tail = text.length > 6 ? text.slice(6) : "";
        const tokens = tail.trim().split(/\s+/).filter(token => token.length > 0);
        const opcode = (tokens[0] ?? "").toUpperCase();

        const cNewOpcodes = getCNewOpcodes();
        if (opcode && cNewOpcodes.has(opcode)) {
          keyword = "C-NEW";
        } else {
          keyword = "C-SPEC";
        }
      }
    } else {
      return undefined;
    }
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

function getCNewOpcodes(): Set<string> {
  const defaults = new Set<string>([
    "EVAL",
    "EVALR",
    "IF",
    "ELSEIF",
    "ELSE",
    "ENDIF",
    "SELECT",
    "WHEN",
    "OTHER",
    "ENDSL"
  ]);

  const config = vscode.workspace.getConfiguration("rpgClSupport");
  const configured = config.get<unknown>("cNewOpcodes");

  if (Array.isArray(configured)) {
    for (const value of configured) {
      if (typeof value === "string" && value.trim().length > 0) {
        defaults.add(value.trim().toUpperCase());
      }
    }
  }

  return defaults;
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
