#!/usr/bin/env node
/**
 * `dds-print-appearance.json` が原典と一致し、**実機の判定とも食い違わない**ことを検査する。
 *
 * 見るのは 3 つ:
 *   1. 生成し直しても中身が変わらないこと（生成物が最新である）
 *   2. **実機で確かめた 6 件**と一致すること
 *   3. **画面（DSPF）と集合が違う**ことが保たれていること
 *
 * 2 が要点。カラー名は原典の表から取っているが、**その表が帳票のものか**は
 * 原典の中だけでは分からない（画面にも同じ形の表がある）。実機の `CRTPRTF` に
 * 通した結果を錨にしている。
 *
 * 使い方:  node docs/origin/verify-dds-print-appearance.mjs
 * 終了コード: 0=OK / 1=不一致
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const OUT = join(ROOT, "vscode-extension/resources/completion/dds-print-appearance.json");
const DSPF_ATTRS = join(ROOT, "vscode-extension/resources/completion/dds-attributes.json");

/**
 * **実機（IBM i 7.3・2026-08-28）で `CRTPRTF` に通した結果。**
 * `.aidev/works/20260828-dds-prtf-emphasis/verify/probe-prtf-appearance.mjs` が再現する。
 */
const MACHINE = [
  { what: "HIGHLIGHT を様式に", ok: true },
  { what: "HIGHLIGHT を項目に", ok: true },
  { what: "UNDERLINE を様式に", ok: false },
  { what: "UNDERLINE を項目に", ok: true },
  { what: "COLOR(BLK) を項目に", ok: true },
  { what: "COLOR(BRN) を項目に", ok: true },
  { what: "COLOR(WHT) を項目に", ok: false },
  { what: "COLOR を様式に", ok: false }
];

const before = readFileSync(OUT, "utf8");
execFileSync("node", [join(HERE, "generate-dds-print-appearance.mjs")], { stdio: "pipe" });
const after = readFileSync(OUT, "utf8");
if (before !== after) {
  console.error("✗ 生成し直すと中身が変わります（生成物が古い）。生成スクリプトを実行してください。");
  process.exit(1);
}

const data = JSON.parse(after);
const names = data.color.names.map(entry => entry.name);
const problems = [];

// ■ 実機の判定との突き合わせ
const has = (list, value) => list.includes(value);
if (!has(data.highlight.levels, "record") || !has(data.highlight.levels, "field")) {
  problems.push("HIGHLIGHT は様式・項目の両方に書ける（実機で確認）");
}
if (has(data.underline.levels, "record") || !has(data.underline.levels, "field")) {
  problems.push("UNDERLINE は項目レベルだけ（実機で様式に書くと通らない）");
}
if (has(data.color.levels, "record") || !has(data.color.levels, "field")) {
  problems.push("COLOR は項目レベルだけ（実機で様式に書くと通らない）");
}
for (const name of ["BLK", "BRN"]) {
  if (!has(names, name)) problems.push(`COLOR(${name}) は実機で通るのに一覧に無い`);
}
if (has(names, "WHT")) {
  problems.push("COLOR(WHT) は実機で通らないのに一覧にある（画面の名前が混ざっている）");
}

// ■ 画面（DSPF）と集合が違うこと
//   画面の表は英語名の行（`{ color: "white" }`）で持っている。名前の綴りが違うので
//   集合をそのまま比べられない——**食い違う 3 色**を名指しで見る。
const dspf = JSON.parse(readFileSync(DSPF_ATTRS, "utf8"));
const dspfColors = new Set((dspf.colors ?? []).map(row => String(row.color).toLowerCase()));
if (dspfColors.size === 0) {
  problems.push("画面のカラー表が読めません（dds-attributes.json の形が変わった）");
}
if (!dspfColors.has("white")) {
  problems.push("画面に white がありません（前提が変わった）");
}
for (const absent of ["black", "brown"]) {
  if (dspfColors.has(absent)) {
    problems.push(`画面に ${absent} が現れました（帳票にしかない色という前提が崩れています）`);
  }
}

if (data.color.default !== "BLK") {
  problems.push(`既定は黒（BLK）のはずです: ${data.color.default}`);
}
if (data.highlight.inheritsFromRecord !== true) {
  problems.push("HIGHLIGHT は様式に書くとその中の全項目に効く（原典）");
}

if (problems.length > 0) {
  console.error("✗ 帳票の見え方の定義が原典 / 実機と食い違います:");
  for (const problem of problems) console.error(`   ${problem}`);
  process.exit(1);
}

console.log(
  `✓ 帳票の見え方 OK（カラー名 ${names.length} 件・実機で確かめた ${MACHINE.length} 件と一致）`
);
