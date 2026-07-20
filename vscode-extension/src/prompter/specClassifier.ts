import * as vscode from "vscode";
import type { Dialect } from "./types";
import {
  DEFAULT_C_NEW_OPCODES,
  classifyRpgSpecKeyword as classifyCore
} from "../core/rpgSpec";

/**
 * RPG 仕様書種別判定の vscode 側の殻。
 *
 * 判定そのものは `core/rpgSpec.ts`（vscode 非依存）にあり、ここは設定
 * `rpgClSupport.cNewOpcodes` を読んで渡すだけ。lint core が同じ判定を使うための
 * 分離で、既存の import パスと公開シグネチャ（位置引数）は変えていない。
 */
export function classifyRpgSpecKeyword(
  text: string,
  dialect?: Dialect,
  // I/O 仕様書はプログラム記述か外部記述かで桁の意味が変わる。それは
  // その行ではなく F 仕様書（22 桁目）で決まるため、前の行が必要になる。
  precedingLines?: readonly string[]
): string | undefined {
  return classifyCore(text, {
    dialect,
    precedingLines,
    cNewOpcodes: getCNewOpcodes()
  });
}

/**
 * C 仕様の「新形式」オペコード集合（既定 + 設定 rpgClSupport.cNewOpcodes）。
 */
export function getCNewOpcodes(): Set<string> {
  const defaults = new Set<string>(DEFAULT_C_NEW_OPCODES);

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
