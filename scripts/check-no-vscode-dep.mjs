#!/usr/bin/env node
// packages/* が vscode に依存していないことを検査する（requirement AC9）。
//
// 型システム側の防御（各パッケージの tsconfig の "types": ["node"] と、
// package.json に @types/vscode を入れないこと）とは別に、明示的なガードとして置く。
// 型側は設定を緩めると静かに無効化されうるが、こちらは grep 相当なので意図が読める。
//
// 終了コード: 0 = 違反なし / 1 = 違反あり（CI を落とす）

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES_DIR = join(ROOT, "packages");

// `import ... from "vscode"` / `require("vscode")` / `import("vscode")` を拾う。
// "vscode-uri" のような別パッケージを誤検出しないよう、閉じ引用符まで含めて一致させる。
const PATTERNS = [
  /\bfrom\s*["']vscode["']/,
  /\brequire\s*\(\s*["']vscode["']\s*\)/,
  /\bimport\s*\(\s*["']vscode["']\s*\)/,
  /^\s*import\s+["']vscode["']/m
];

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];
const SKIP_DIRS = new Set(["node_modules", "out", "out-test", ".git"]);

function collectSourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

if (!existsSync(PACKAGES_DIR)) {
  console.log("check-no-vscode-dep: packages/ が無いため検査をスキップします。");
  process.exit(0);
}

const violations = [];

for (const pkg of readdirSync(PACKAGES_DIR)) {
  const pkgDir = join(PACKAGES_DIR, pkg);
  if (!statSync(pkgDir).isDirectory()) continue;

  // 1. 依存宣言に vscode 関連が無いこと
  const manifestPath = join(pkgDir, "package.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        if (name === "vscode" || name === "@types/vscode") {
          violations.push(
            `${relative(ROOT, manifestPath)}: ${field} に ${name} が宣言されています`
          );
        }
      }
    }
  }

  // 2. ソースに vscode の import が無いこと
  for (const file of collectSourceFiles(pkgDir)) {
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, index) => {
      if (PATTERNS.some((pattern) => pattern.test(line))) {
        violations.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error("packages/ が vscode に依存しています（requirement AC9 違反）:");
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(
    "\nvscode に依存してよいのは vscode-extension/ だけです。" +
      "コアの機能は packages/ に置き、拡張側から呼び出してください。"
  );
  process.exit(1);
}

console.log("check-no-vscode-dep: OK（packages/ に vscode 依存なし）");
