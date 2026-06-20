import * as vscode from "vscode";

/**
 * スペック種別 → フィールド開始桁（0-indexed・昇順）の対応。
 * 真実源は `resources/navigation/rpg-fixed-keyword-columns.json`（値は 1 始まり桁）。
 */
export type RpgKeywordColumns = Map<string, readonly number[]>;

let cachedRpgKeywordColumns: RpgKeywordColumns | undefined;
let cachedClKeywordColumns: readonly number[] | undefined;

/**
 * RPG 固定フォーマットのスペック種別ごとのキーワード桁定義を読み込む。
 * タブナビゲーション・ルーラー表示など複数機能の単一真実源。
 */
export async function getRpgKeywordColumns(
  context: vscode.ExtensionContext
): Promise<RpgKeywordColumns> {
  if (cachedRpgKeywordColumns) {
    return cachedRpgKeywordColumns;
  }

  const map: RpgKeywordColumns = new Map();

  try {
    const uri = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "navigation",
      "rpg-fixed-keyword-columns.json"
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const raw = document.getText();
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    for (const [key, value] of Object.entries(parsed)) {
      const columns = parseColumnsValue(value);
      if (columns.length > 0) {
        map.set(key.toUpperCase(), columns);
      }
    }
  } catch (error) {
    console.log(
      "[rpgClSupport] failed to load RPG keyword column definitions",
      String(error)
    );
  }

  cachedRpgKeywordColumns = map;
  return map;
}

/**
 * CL のキーワード桁定義を読み込む。
 */
export async function getClKeywordColumns(
  context: vscode.ExtensionContext
): Promise<readonly number[] | undefined> {
  if (cachedClKeywordColumns) {
    return cachedClKeywordColumns;
  }

  try {
    const uri = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "navigation",
      "cl-keyword-columns.json"
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const raw = document.getText();
    const parsed = JSON.parse(raw) as unknown;
    const columns = parseColumnsValue(parsed);

    if (columns.length > 0) {
      cachedClKeywordColumns = columns;
      return columns;
    }
  } catch (error) {
    console.log(
      "[rpgClSupport] failed to load CL keyword column definitions",
      String(error)
    );
  }

  cachedClKeywordColumns = [];
  return cachedClKeywordColumns;
}

export function parseColumnsValue(value: unknown): number[] {
  if (typeof value === "string") {
    return parseColumnsFromString(value);
  }

  if (Array.isArray(value)) {
    return parseColumnsFromArray(value);
  }

  if (
    value &&
    typeof value === "object" &&
    "columns" in value &&
    (typeof (value as { columns?: unknown }).columns === "string" ||
      Array.isArray((value as { columns?: unknown }).columns))
  ) {
    const inner = (value as { columns: unknown }).columns;
    return parseColumnsValue(inner);
  }

  return [];
}

function parseColumnsFromString(raw: string): number[] {
  const parts = raw.split(/[,、\s]+/u).filter(part => part.length > 0);
  const columns: number[] = [];

  for (const part of parts) {
    const parsed = Number(part);
    if (Number.isFinite(parsed) && parsed > 0) {
      columns.push(parsed - 1);
    }
  }

  return columns.sort((a, b) => a - b);
}

function parseColumnsFromArray(values: unknown[]): number[] {
  const columns: number[] = [];

  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      columns.push(Math.floor(value) - 1);
    } else if (typeof value === "string") {
      const nested = parseColumnsFromString(value);
      columns.push(...nested);
    }
  }

  return columns.sort((a, b) => a - b);
}
