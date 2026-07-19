#!/usr/bin/env node
/**
 * package.json の contributes が、対象拡張子の定義とずれていないか検査する。
 *
 * 拡張子を足しても、それを消費する側（キーバインド）に足し忘れると機能は動かない。
 * 実際、DDS と .cmd のプロンプター定義を用意したのに F4 のキーバインドが
 * rpg-fixed / cl と .rpgle / .clp にしか効かず、.cmd も DDS も .rpg も
 * .sqlrpgle も .clle も F4 が発火しない状態だった。
 *
 * 真実源は src/utils/fileScope.ts の TARGET_EXTENSIONS。
 *
 * 使い方:  node docs/origin/verify-contributes.mjs
 * 終了コード: 0=OK / 1=不一致
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const EXT = join(ROOT, "vscode-extension");

const source = readFileSync(join(EXT, "src/utils/fileScope.ts"), "utf8");
const block = /TARGET_EXTENSIONS\s*=\s*\[([\s\S]*?)\]/u.exec(source);
if (!block) {
  console.error("✗ fileScope.ts の TARGET_EXTENSIONS が読めない");
  process.exit(1);
}
const extensions = [...block[1].matchAll(/"([a-z0-9]+)"/gu)].map(m => m[1]);

const manifest = JSON.parse(readFileSync(join(EXT, "package.json"), "utf8"));
const failures = [];

/** F4 は対象拡張子すべてで発火しなければならない。 */
const prompter = (manifest.contributes?.keybindings ?? []).find(
  binding => binding.command === "rpgClSupport.showPrompter"
);

if (!prompter) {
  failures.push("F4（showPrompter）のキーバインドが無い");
} else {
  const missing = extensions.filter(
    ext => !prompter.when.includes(`resourceExtname == .${ext}`)
  );
  if (missing.length > 0) {
    failures.push(`F4 が効かない拡張子: ${missing.map(e => `.${e}`).join(" ")}`);
  }

  // 逆に、対象でない拡張子が紛れていないか。
  const extra = [...prompter.when.matchAll(/resourceExtname == \.([a-z0-9]+)/gu)]
    .map(m => m[1])
    .filter(ext => !extensions.includes(ext));
  if (extra.length > 0) {
    failures.push(`対象外なのに F4 が効く拡張子: ${extra.map(e => `.${e}`).join(" ")}`);
  }
}

console.log(`contributes の検査（対象拡張子 ${extensions.length} 件）`);

if (failures.length > 0) {
  console.error(`\n✗ contributes NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("✓ contributes OK（F4 が対象拡張子すべてで発火する）");
