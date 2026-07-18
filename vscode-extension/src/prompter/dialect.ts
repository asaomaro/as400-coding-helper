import * as vscode from "vscode";
import type { Dialect } from "./types";

/**
 * 拡張子 → 方言(dialect) 対応の単一真実源。
 *
 * RPG 固定長の方言は languageId(`rpg-fixed`) からは導出できない
 * （`.rpgle` と `.rpg` がともに `rpg-fixed`)。そのためファイルパスの
 * 拡張子から判定する。曖昧な `.rpg` 運用向けに設定で上書きできる。
 */

const DIALECTS: ReadonlySet<string> = new Set<Dialect>(["ile", "rpg3"]);

/** 既定の拡張子→方言マップ。設定が無い／不正なときのフォールバック。 */
export const DEFAULT_DIALECT_BY_EXTENSION: Readonly<Record<string, Dialect>> = {
  ".sqlrpgle": "ile",  // SQL 組み込み ILE RPG
  ".rpgle": "ile",
  ".sqlrpg": "rpg3",   // SQL 組み込み RPG III
  ".rpg": "rpg3"
};

/** 拡張子で判定できなかった場合の既定方言（従来は全 rpg-fixed を ILE 扱い）。 */
const FALLBACK_DIALECT: Dialect = "ile";

/** 設定キー（VSCode 標準スコープでフォルダ別上書き可能）。 */
const CONFIG_SECTION = "rpgClSupport";
const CONFIG_KEY = "rpgDialectByExtension";

/**
 * 拡張子マップを正規化する。キーは小文字化＋先頭 `.` を補い、
 * 値が `ile`/`rpg3` 以外のエントリは捨てる。
 */
function normalizeOverrides(
  overrides: Record<string, unknown> | undefined
): Record<string, Dialect> {
  const normalized: Record<string, Dialect> = {};
  if (!overrides) {
    return normalized;
  }

  for (const [rawKey, rawValue] of Object.entries(overrides)) {
    if (typeof rawValue !== "string") {
      continue;
    }
    const value = rawValue.trim().toLowerCase();
    if (!DIALECTS.has(value)) {
      continue;
    }

    let key = rawKey.trim().toLowerCase();
    if (key.length === 0) {
      continue;
    }
    if (!key.startsWith(".")) {
      key = `.${key}`;
    }

    normalized[key] = value as Dialect;
  }

  return normalized;
}

/**
 * ファイルパスから方言を導出する純関数（vscode 非依存・unit テスト対象）。
 * 既定マップに上書きをマージし、拡張子は長い順に照合する
 * （`.rpgle` を `.rpg` より先に判定するため）。一致しなければ ile。
 */
export function resolveDialectFromPath(
  fsPath: string,
  overrides?: Record<string, unknown>
): Dialect {
  const map: Record<string, Dialect> = {
    ...DEFAULT_DIALECT_BY_EXTENSION,
    ...normalizeOverrides(overrides)
  };

  const lower = fsPath.toLowerCase();
  const extensions = Object.keys(map).sort((a, b) => b.length - a.length);

  for (const ext of extensions) {
    if (lower.endsWith(ext)) {
      return map[ext] ?? FALLBACK_DIALECT;
    }
  }

  return FALLBACK_DIALECT;
}

/**
 * ドキュメントから方言を導出する（設定 `rpgClSupport.rpgDialectByExtension` を反映）。
 */
export function resolveDialect(document: vscode.TextDocument): Dialect {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const overrides = config.get<Record<string, unknown>>(CONFIG_KEY);
  return resolveDialectFromPath(document.uri.fsPath, overrides);
}
