#!/usr/bin/env node
/**
 * キーワードを**どのレベルに書けるか**（ファイル / レコード / フィールド）を取り出す。
 *
 * 補完データ（`dds-keywords.json`）には既に `level` があるが、**あちらは
 * 説明文もろとも重い**（176 件 × 解説）。`resolveDspfLayout` は WebView にも
 * 束ねられるので、**名前とレベルだけの軽い資源**を別に作る
 * （`dds-conditioning.json` と同じ形）。
 *
 * ## 判別できなかったものは入れない
 *
 * `level` が空のキーワードは**どのレベルでも咎めない**（AGENTS.md「判別できなかった
 * ものはどのレベルでも出す」）。ここに入れないことでそれを表す——
 * 「一覧に無い ＝ 判断しない」。
 *
 * 出力: resources/completion/dds-keyword-levels.json
 *
 * 使い方:  node docs/origin/generate-dds-keyword-levels.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const IN = join(ROOT, "vscode-extension/resources/completion/dds-keywords.json");
const OUT = join(ROOT, "vscode-extension/resources/completion/dds-keyword-levels.json");

/** 配置に関わるレベルだけを採る。`key` / `join` / `help` は配置の話ではない。 */
const PLACEMENT_LEVELS = ["file", "record", "field"];

const source = JSON.parse(readFileSync(IN, "utf8"));
const keywords = {};
const counts = {};

for (const [type, list] of Object.entries(source)) {
  const table = {};
  for (const entry of list) {
    const levels = (entry.level ?? []).filter(level => PLACEMENT_LEVELS.includes(level));
    // **判別できなかったものは入れない**（＝どのレベルでも咎めない）。
    // 配置以外のレベル（key / join / help）しか持たないものも入れない。
    if (levels.length === 0) continue;
    table[entry.name] = levels;
  }
  keywords[type.replace(/^DDS-/u, "")] = table;
  counts[type.replace(/^DDS-/u, "")] = Object.keys(table).length;
}

const data = {
  note:
    "キーワードを書けるレベル（file / record / field）。" +
    "docs/origin/generate-dds-keyword-levels.mjs が dds-keywords.json から作る。手で編集しないこと。" +
    "一覧に無いキーワードは「判別できなかった」＝どのレベルでも咎めない。",
  source: "resources/completion/dds-keywords.json（原典の各キーワード詳細ページ由来）",
  keywords,
  counts
};

writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(
  `✓ dds-keyword-levels.json を生成しました（${Object.entries(counts)
    .map(([type, n]) => `${type} ${n} 件`)
    .join(" / ")}）`
);
