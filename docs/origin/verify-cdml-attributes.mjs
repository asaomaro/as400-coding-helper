#!/usr/bin/env node
/**
 * CDML の全属性に「使う／使わない」の判断が記録されているかを検査する。
 *
 * 実機の CDML に本 PJ が見ていない属性が残っている状態を作らないための検査。
 * 新しい属性が出てきたら docs/origin/cdml-attributes.md に追記して判断を残す。
 *
 * 使い方:  node docs/origin/verify-cdml-attributes.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CMDDEF = join(HERE, "cmddef");
const DOC = join(HERE, "cdml-attributes.md");

if (!existsSync(CMDDEF)) {
  console.error(`${CMDDEF} が無い。collect-cmd-definitions.sh で収集する。`);
  process.exit(1);
}

const seen = new Set();
for (const name of readdirSync(CMDDEF).filter(n => n.endsWith(".xml"))) {
  const text = readFileSync(join(CMDDEF, name), "utf8");
  for (const tag of text.matchAll(/<(\w+)([^>]*)>/g)) {
    for (const attribute of tag[2].matchAll(/([A-Za-z]+)\s*=\s*"/g)) {
      seen.add(attribute[1]);
    }
  }
}

const doc = readFileSync(DOC, "utf8");
const undocumented = [...seen].filter(name => !doc.includes(`\`${name}\``)).sort();

console.log(`CDML に現れる属性 ${seen.size} 種類`);
if (undocumented.length > 0) {
  console.error(`\n判断が記録されていない属性 ${undocumented.length} 件:`);
  for (const name of undocumented) console.error(`  - ${name}`);
  console.error(`\n${DOC} に追記すること。`);
  process.exit(1);
}
console.log("すべての属性に使う/使わないの判断が記録されている。");
