#!/usr/bin/env node
/**
 * **実機の受理集合と定義の値集合を突き合わせる。**
 *
 * 目で見比べない。`restricted: true` を立てる根拠そのものなので、
 * **機械で突き合わせて結果を残す**（`compare.json`）。
 *
 * 実機の結果は 3 本のプローブに分かれている:
 *   exhaustive-report.json  物理(CRTPF) / 表示装置 / 印刷装置
 *   logical-report.json     単純論理(PFILE)
 *   join-report.json        結合論理(JFILE)
 *
 * **物理/論理の欄は 3 文脈の和を採る。** 原典が 38 桁目で文脈ごとに値を分けており
 * （物理 = ブランク/B、論理 = ＋I、結合論理だけ N、結合論理に B は不可）、
 * 定義 1 つが `.pf` と `.lf` の両方を担うので、**定義に対応するのは和**。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFS = join(HERE, "../../../../vscode-extension/resources/prompter/dds");
const read = f => JSON.parse(readFileSync(join(HERE, f), "utf8"));

const ex = read("exhaustive-report.json").results;
const lf = read("logical-report.json").out;
const jn = read("join-report.json").out;

/** 実機の受理集合（文脈ごと）。17 桁は単独確認の結果を優先する。 */
const accepted = key => {
  const r = ex[key];
  return new Set(r.acceptedConfirmed ?? r.accepted);
};
const setOf = a => new Set(a);
const show = s => [...s].map(c => (c === " " ? "_" : c)).sort().join("");

const TARGETS = [
  { type: "DDS-PF", column: 17, machine: () => new Set([...accepted("XPF17"), ...lf.XLF17.accepted, ...jn.XJN17.accepted]),
    contexts: "物理 / 単純論理 / 結合論理" },
  { type: "DDS-PF", column: 35, machine: () => accepted("XPF35"), contexts: "物理" },
  { type: "DDS-PF", column: 38, machine: () => new Set([...accepted("XPF38"), ...lf.XLF38.accepted, ...jn.XJN38.accepted]),
    contexts: "物理 / 単純論理 / 結合論理" },
  { type: "DDS-DSPF", column: 17, machine: () => accepted("XDS17"), contexts: "表示装置" },
  { type: "DDS-DSPF", column: 35, machine: () => accepted("XDS35"), contexts: "表示装置" },
  { type: "DDS-DSPF", column: 38, machine: () => null, contexts: "前作業で確定済み（20260829-dds-restricted-enable）" },
  { type: "DDS-PRTF", column: 17, machine: () => accepted("XPR17"), contexts: "印刷装置" },
  { type: "DDS-PRTF", column: 35, machine: () => accepted("XPR35"), contexts: "印刷装置" }
];

const rows = [];
for (const t of TARGETS) {
  const def = JSON.parse(readFileSync(join(DEFS, "ja", `${t.type}.json`), "utf8"));
  const parameter = def.parameters.find(p => p.sourceStart === t.column && p.sourceLength === 1);
  const defined = setOf((parameter?.options ?? []).map(o => (o.value === "" ? " " : o.value)));
  const machine = t.machine();
  if (!machine) {
    rows.push({ ...t, defined: show(defined), machine: "-", verdict: "対象外", missing: "", extra: "" });
    continue;
  }
  const missing = [...machine].filter(c => !defined.has(c));   // 実機が受けるのに定義に無い
  const extra = [...defined].filter(c => !machine.has(c));     // 定義にあるのに実機が弾く
  rows.push({
    type: t.type, column: t.column, contexts: t.contexts,
    defined: show(defined), machine: show(machine),
    missing: show(setOf(missing)), extra: show(setOf(extra)),
    verdict: missing.length === 0 && extra.length === 0 ? "一致" : "不一致"
  });
}

const w = (s, n) => String(s).padEnd(n - [...String(s)].filter(c => c.charCodeAt(0) > 0x2000).length);
console.log(`${w("欄", 16)} ${w("実機の受理", 22)} ${w("定義", 22)} 判定`);
for (const r of rows) {
  console.log(`${w(`${r.type.replace("DDS-", "")} ${r.column}桁`, 16)} ${w(r.machine, 22)} ${w(r.defined, 22)} ${r.verdict}` +
    (r.missing ? `  実機のみ:${r.missing}` : "") + (r.extra ? `  定義のみ:${r.extra}` : ""));
}
const ok = rows.filter(r => r.verdict === "一致").map(r => `${r.type}:${r.column}`);
console.log(`\nPROVEN_COMPLETE の候補（${ok.length} 件）:\n  ${ok.map(x => `"${x}"`).join(", ")}`);
writeFileSync(join(HERE, "compare.json"), JSON.stringify(rows, null, 2));
