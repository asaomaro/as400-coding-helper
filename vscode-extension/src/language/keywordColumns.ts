import * as vscode from "vscode";

/**
 * スペック種別 → フィールド開始桁（0-indexed・昇順）の対応。
 * 真実源は `resources/navigation/rpg-fixed-keyword-columns.json`（値は 1 始まり桁）。
 */
export type RpgKeywordColumns = Map<string, readonly number[]>;

let cachedRpgKeywordColumns: RpgKeywordColumns | undefined;
let cachedDdsKeywordColumns: RpgKeywordColumns | undefined;

/**
 * DDS の定位置項目の桁定義を読み込む（種別 → 桁）。
 * DDS は用途（物理/論理・表示装置・印刷装置）で桁の意味が変わるため、
 * 種別ごとに別のエントリーを持つ。
 */
export async function getDdsKeywordColumns(
  context: vscode.ExtensionContext
): Promise<RpgKeywordColumns> {
  if (cachedDdsKeywordColumns) {
    return cachedDdsKeywordColumns;
  }

  const map: RpgKeywordColumns = new Map();
  try {
    const uri = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "navigation",
      "dds-keyword-columns.json"
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const parsed = JSON.parse(document.getText()) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      const columns = parseColumnsValue(value);
      if (columns.length > 0) {
        map.set(key.toUpperCase(), columns);
      }
    }
  } catch (error) {
    console.log("[rpgClSupport] failed to load DDS keyword column definitions", String(error));
  }

  cachedDdsKeywordColumns = map;
  return map;
}

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

const cachedKeywordColumnsByKind = new Map<string, readonly number[]>();

/**
 * CL / コマンド定義ソースのキーワード桁定義を読み込む。
 * どちらも「ラベル 1-13 / 文 14 / パラメータ 25」だが、欄の呼び名が違うため
 * 定義ファイルを分けてある（CL は Command、.cmd は Statement）。
 */
export async function getClKeywordColumns(
  context: vscode.ExtensionContext,
  kind: "CL" | "CMD" = "CL"
): Promise<readonly number[] | undefined> {
  const cached = cachedKeywordColumnsByKind.get(kind);
  if (cached) {
    return cached;
  }

  try {
    const uri = vscode.Uri.joinPath(
      context.extensionUri,
      "resources",
      "navigation",
      kind === "CMD" ? "cmd-keyword-columns.json" : "cl-keyword-columns.json"
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const raw = document.getText();
    const parsed = JSON.parse(raw) as unknown;
    const columns = parseColumnsValue(parsed);

    if (columns.length > 0) {
      cachedKeywordColumnsByKind.set(kind, columns);
      return columns;
    }
  } catch (error) {
    console.log(
      "[rpgClSupport] failed to load keyword column definitions",
      String(error)
    );
  }

  cachedKeywordColumnsByKind.set(kind, []);
  return cachedKeywordColumnsByKind.get(kind);
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
