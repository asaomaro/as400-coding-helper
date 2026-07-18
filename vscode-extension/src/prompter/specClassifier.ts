import * as vscode from "vscode";
import type { Dialect } from "./types";

/**
 * RPG 固定長ソース行のスペック種別（keyword）判定を **単一の真実**として提供する。
 * ルーラー表示（ruler.ts）と F4 プロンプター／タブナビ（positionResolver.ts）が
 * 同じ規約を共有し、片方だけに種別追加が漏れる（ドリフト）のを防ぐ。
 *
 * 6 桁目（index 5）のスペック文字で分類する。C は新旧を cNewOpcodes で判定するが、
 * RPG III(rpg3) には C-NEW(自由形演算) が存在しないため、dialect 指定時は常に C-SPEC。
 */
export function classifyRpgSpecKeyword(
  text: string,
  dialect?: Dialect,
  // I/O 仕様書はプログラム記述か外部記述かで桁の意味が変わる。それは
  // その行ではなく F 仕様書（22 桁目）で決まるため、前の行が必要になる。
  precedingLines?: readonly string[]
): string | undefined {
  if (text.length < 6) {
    return undefined;
  }

  const specChar = text.charAt(5).toUpperCase();
  switch (specChar) {
    case "H":
      return "H-SPEC";
    case "F":
      return "F-SPEC";
    case "D":
      return "D-SPEC";
    case "I":
    case "O":
      // RPG III(rpg3) は I/O をレイアウト別に分けていない（原典が別系統で、
      // rpg3 側の定義は I-SPEC / O-SPEC の1本ずつ）。分割は ILE に限る。
      return dialect === "rpg3"
        ? `${specChar}-SPEC`
        : classifyIoSpec(specChar as "I" | "O", text, precedingLines);
    case "P":
      return "P-SPEC";
    case "C":
      return classifyCSpec(text, dialect);
    default:
      return undefined;
  }
}

/** 7-16 桁目を取り出す（ファイル名／レコード様式名の欄）。 */
function nameField(text: string): string {
  return text.slice(6, 16).trim();
}

/**
 * I/O 仕様書の種別を決める。
 *
 * 行タイプ:
 *   7-16 桁目に名前がある → レコード識別行、空 → フィールド記述行。
 * 記述種別:
 *   直前のレコード識別行の名前を F 仕様書から探し、22 桁目が E なら外部記述。
 *   F 仕様書に無い名前（外部記述のレコード様式名）も外部記述として扱う。
 *   判断材料が無い場合はプログラム記述を既定とする（固定形式の既定の姿）。
 */
function classifyIoSpec(
  spec: "I" | "O",
  text: string,
  precedingLines?: readonly string[]
): string {
  const isRecordLine = nameField(text).length > 0;
  const lineType = isRecordLine ? "REC" : "FLD";

  const recordName = isRecordLine
    ? nameField(text)
    : findRecordNameAbove(spec, precedingLines);

  const describedBy = resolveFileDescription(recordName, precedingLines);
  return `${spec}-SPEC-${lineType}-${describedBy}`;
}

/** フィールド記述行から見て、直前のレコード識別行の名前を探す。 */
function findRecordNameAbove(
  spec: "I" | "O",
  precedingLines?: readonly string[]
): string | undefined {
  if (!precedingLines) return undefined;

  for (let i = precedingLines.length - 1; i >= 0; i -= 1) {
    const line = precedingLines[i] ?? "";
    if (line.length < 6) continue;
    if (line.charAt(5).toUpperCase() !== spec) continue;
    const name = nameField(line);
    if (name.length > 0) return name;
  }
  return undefined;
}

/**
 * 名前に対応するファイルがプログラム記述か外部記述かを F 仕様書から判定する。
 * F 仕様書の 22 桁目は「ファイル形式」で、E=外部記述 / F=プログラム記述。
 */
function resolveFileDescription(
  name: string | undefined,
  precedingLines?: readonly string[]
): "PGM" | "EXT" {
  if (!name || !precedingLines) return "PGM";

  for (const line of precedingLines) {
    if (line.length < 22) continue;
    if (line.charAt(5).toUpperCase() !== "F") continue;
    if (nameField(line).toUpperCase() !== name.toUpperCase()) continue;
    return line.charAt(21).toUpperCase() === "E" ? "EXT" : "PGM";
  }

  // F 仕様書に無い名前は、外部記述ファイルのレコード様式名とみなす。
  return "EXT";
}

/**
 * C 仕様の新旧判定。dialect が rpg3 のときは C-NEW が存在しないため常に C-SPEC。
 * それ以外（ile / 未指定＝ルーラー表示）は先頭オペコードで C-NEW を判定する。
 */
function classifyCSpec(text: string, dialect?: Dialect): string {
  if (dialect === "rpg3") {
    return "C-SPEC";
  }
  const tail = text.length > 6 ? text.slice(6) : "";
  const tokens = tail.trim().split(/\s+/u).filter(token => token.length > 0);
  const opcode = (tokens[0] ?? "").toUpperCase();
  return opcode && getCNewOpcodes().has(opcode) ? "C-NEW" : "C-SPEC";
}

/**
 * C 仕様の「新形式」オペコード集合（既定 + 設定 rpgClSupport.cNewOpcodes）。
 */
export function getCNewOpcodes(): Set<string> {
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
