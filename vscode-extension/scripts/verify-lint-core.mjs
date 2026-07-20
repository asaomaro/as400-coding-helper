#!/usr/bin/env node
/**
 * lint core の境界を機械的に検査する。
 *
 * 1. **純粋性**: src/core / src/lint / src/cli が vscode を import していないこと。
 *    これが崩れると lint コマンドが素の node で動かなくなる（CI から使えない）。
 * 2. **拡張子の部分集合**: LINTABLE_EXTENSIONS ⊆ TARGET_EXTENSIONS であること。
 *
 * ■ なぜ tsconfig を分ける方式にしなかったか
 *   当初は「types から "vscode" を外した tsconfig でコンパイルが落ちること」で
 *   純粋性を担保する設計だった（design D6）。**これは効かない。**
 *   `types` は *自動読み込み* の対象を絞るだけで、`import "vscode"` の
 *   モジュール解決は node_modules/@types/vscode に届いてしまう。
 *   `typeRoots` も `paths` も通常の node 解決へフォールバックするため塞げない。
 *   実際に違反コードを置いて確認した（exit 0 のまま通過した）。
 *
 * ■ なぜ grep にしなかったか
 *   コメントや文字列中の "vscode" を誤検出し、逆に複数行 import を取りこぼす。
 *   ここでは TypeScript の `preProcessFile` で import を構文的に取り出す
 *   （typescript は既に devDependency にあり、新たな依存を増やさない）。
 *
 * 使い方:  node scripts/verify-lint-core.mjs
 * 終了コード: 0=OK / 1=違反あり
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = join(HERE, "..");

/** 純粋（vscode 非依存）でなければならないディレクトリ。 */
const PURE_DIRS = ["src/core", "src/lint", "src/cli"];

const failures = [];

/* ------------------------------------------------------------------ *
 * 1. 純粋性
 * ------------------------------------------------------------------ */

function collectTsFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

let scanned = 0;
for (const relDir of PURE_DIRS) {
  for (const file of collectTsFiles(join(EXT, relDir))) {
    scanned += 1;
    const text = readFileSync(file, "utf8");
    // 第2引数=readImportFiles / 第3引数=detectJavaScriptImports
    const info = ts.preProcessFile(text, true, true);
    const imports = [
      ...info.importedFiles.map(f => f.fileName),
      ...(info.referencedFiles ?? []).map(f => f.fileName)
    ];
    for (const specifier of imports) {
      if (specifier === "vscode" || specifier.startsWith("vscode/")) {
        failures.push(
          `${relative(EXT, file)} が "${specifier}" を import している` +
            "（この層は素の node で動かす必要がある）"
        );
      }
    }
  }
}

if (scanned === 0) {
  failures.push(
    `純粋性を検査する対象が 1 ファイルも無い（${PURE_DIRS.join(" / ")}）。` +
      "パスの指定が壊れていないか確認すること"
  );
}

/* ------------------------------------------------------------------ *
 * 2. 拡張子の部分集合
 * ------------------------------------------------------------------ */

function extractStringArray(source, name, label) {
  const block = new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`, "u").exec(source);
  if (!block) {
    failures.push(`${label} の ${name} が読めない`);
    return undefined;
  }
  return [...block[1].matchAll(/"([a-z0-9]+)"/gu)].map(m => m[1]);
}

const target = extractStringArray(
  readFileSync(join(EXT, "src/utils/fileScope.ts"), "utf8"),
  "TARGET_EXTENSIONS",
  "fileScope.ts"
);
const lintable = extractStringArray(
  readFileSync(join(EXT, "src/core/sourceKind.ts"), "utf8"),
  "LINTABLE_EXTENSIONS",
  "core/sourceKind.ts"
);

if (target && lintable) {
  const missing = lintable.filter(ext => !target.includes(ext));
  if (missing.length > 0) {
    failures.push(
      `LINTABLE_EXTENSIONS が TARGET_EXTENSIONS に無い拡張子を含む: ${missing.join(", ")}`
    );
  }
}

/* ------------------------------------------------------------------ */

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}

console.log(
  `✓ lint core の境界 OK（純粋性 ${scanned} ファイル / ` +
    `対象拡張子 ${lintable?.length ?? 0} 件は TARGET_EXTENSIONS の部分集合）`
);
