#!/usr/bin/env node
/**
 * CDML(DEP / PMTCTL) の演算子の集合が、DTD・スキーマ・実データの三者でずれて
 * いないことを検査する。
 *
 * ずれると黙って壊れる:
 *   - 実データに未知の演算子が来ると、評価が既定の分岐に落ちて規則が効かなくなる
 *   - スキーマの union に無い値は型では弾けても JSON では素通りする
 *
 * 正は実機の DTD(/QIBM/XML/DTD/QcdCLCmd.dtd)。本スクリプトはその宣言を写して
 * おり、実データ(docs/origin/cmddef/*.xml)と TypeScript の union の双方を
 * これに突き合わせる。
 *
 * 使い方:  node docs/origin/verify-cdml-rules.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const CMDDEF = join(HERE, "cmddef");
const TYPES = join(ROOT, "vscode-extension/src/prompter/types.ts");

// DTD の宣言そのもの（/QIBM/XML/DTD/QcdCLCmd.dtd）。
const DTD = {
  "Dep.CtlKwdRel": ["GT", "EQ", "GE", "LT", "NE", "LE", "SPCFD", "ALWAYS"],
  "Dep.NbrTrueRel": ["GT", "EQ", "GE", "LT", "NE", "LE", "ALL"],
  "DepParm.Rel": ["GT", "EQ", "GE", "LT", "NE", "LE", "SPCFD"],
  "PmtCtl.NbrTrueRel": ["ALL", "GT", "EQ", "GE", "LT", "NE", "LE"],
  "PmtCtl.LglRel": ["AND", "OR"],
  "PmtCtlCond.Rel": ["GT", "EQ", "GE", "LT", "NE", "LE", "SPCFD", "UNSPCFD"]
};

// スキーマ側の union 名と、DTD のどの集合に対応するか。
const SCHEMA = {
  CdmlDepControlRelation: "Dep.CtlKwdRel",
  CdmlCountRelation: "Dep.NbrTrueRel",
  CdmlDepTermRelation: "DepParm.Rel",
  CdmlPromptControlRelation: "PmtCtlCond.Rel"
};

const problems = [];

// --- 1. 実データが DTD の集合に収まっているか ---
if (!existsSync(CMDDEF)) {
  console.error(`${CMDDEF} が無い。docs/origin/collect-cmd-definitions.sh で収集する。`);
  process.exit(1);
}

const seen = Object.fromEntries(Object.keys(DTD).map(k => [k, new Set()]));
const attr = (text, name) => {
  const m = text.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : undefined;
};
const record = (key, value) => {
  if (value !== undefined) seen[key].add(value);
};

let files = 0;
for (const name of readdirSync(CMDDEF).filter(n => n.endsWith(".xml"))) {
  const text = readFileSync(join(CMDDEF, name), "utf8");
  files += 1;
  for (const m of text.matchAll(/<Dep ([^>]*)>/g)) {
    record("Dep.CtlKwdRel", attr(m[1], "CtlKwdRel"));
    record("Dep.NbrTrueRel", attr(m[1], "NbrTrueRel"));
  }
  for (const m of text.matchAll(/<DepParm ([^>]*)\/>/g)) {
    record("DepParm.Rel", attr(m[1], "Rel"));
  }
  for (const m of text.matchAll(/<PmtCtl ([^>]*)>/g)) {
    record("PmtCtl.NbrTrueRel", attr(m[1], "NbrTrueRel"));
    record("PmtCtl.LglRel", attr(m[1], "LglRel"));
  }
  for (const m of text.matchAll(/<PmtCtlCond ([^>]*)\/>/g)) {
    record("PmtCtlCond.Rel", attr(m[1], "Rel"));
  }
}

for (const [key, allowed] of Object.entries(DTD)) {
  for (const value of seen[key]) {
    if (!allowed.includes(value)) {
      problems.push(`実データに DTD 外の値: ${key} = ${value}`);
    }
  }
}

// --- 2. スキーマの union が DTD の集合と一致するか ---
const types = readFileSync(TYPES, "utf8");
// `export type X = "A" | "B";` と `CdmlRelation | "SPCFD"` の両方を展開する。
const unionOf = name => {
  const m = types.match(new RegExp(`export type ${name} =([^;]*);`));
  if (!m) return null;
  const body = m[1];
  const literals = [...body.matchAll(/"([A-Z]+)"/g)].map(x => x[1]);
  const base = /\bCdmlRelation\b/.test(body) ? unionOf("CdmlRelation") ?? [] : [];
  return [...new Set([...base, ...literals])];
};

for (const [typeName, dtdKey] of Object.entries(SCHEMA)) {
  const actual = unionOf(typeName);
  if (!actual) {
    problems.push(`スキーマに ${typeName} が無い`);
    continue;
  }
  const expected = DTD[dtdKey];
  const missing = expected.filter(v => !actual.includes(v));
  const extra = actual.filter(v => !expected.includes(v));
  if (missing.length) problems.push(`${typeName} に不足: ${missing.join(", ")}`);
  if (extra.length) problems.push(`${typeName} に余分: ${extra.join(", ")}`);
}

// --- 結果 ---
console.log(`CDML ${files} 件を検査`);
for (const [key, values] of Object.entries(seen)) {
  console.log(`  ${key.padEnd(20)} 実データ: ${[...values].sort().join(", ") || "(出現なし)"}`);
}

if (problems.length) {
  console.error(`\n不整合 ${problems.length} 件:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nDTD・スキーマ・実データの演算子の集合は一致している。");
