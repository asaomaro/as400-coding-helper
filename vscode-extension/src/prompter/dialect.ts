import * as vscode from "vscode";
import type { Dialect } from "./types";
import { resolveDialectFromPath } from "../core/dialect";

/**
 * 方言(dialect) 判定の vscode 側の殻。
 *
 * 判定そのものは `core/dialect.ts`（vscode 非依存）にあり、ここは
 * VSCode 設定を読んで渡すだけ。lint core が同じ判定を使うための分離で、
 * 既存の import パスと公開シグネチャは変えていない。
 */

/** 設定キー（VSCode 標準スコープでフォルダ別上書き可能）。 */
const CONFIG_SECTION = "rpgClSupport";
const CONFIG_KEY = "rpgDialectByExtension";

// 既存の利用元・テストが `prompter/dialect` から import しているものを維持する。
export {
  DEFAULT_DIALECT_BY_EXTENSION,
  resolveDialectFromPath
} from "../core/dialect";

/**
 * ドキュメントから方言を導出する（設定 `rpgClSupport.rpgDialectByExtension` を反映）。
 */
export function resolveDialect(document: vscode.TextDocument): Dialect {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const overrides = config.get<Record<string, unknown>>(CONFIG_KEY);
  return resolveDialectFromPath(document.uri.fsPath, overrides);
}
