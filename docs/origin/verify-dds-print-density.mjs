#!/usr/bin/env node
/**
 * 帳票の印刷密度（CPI / LPI）の値が原典と整合しているかを検査する。
 *
 * 生成は docs/origin/generate-dds-print-density.mjs。ここで見るのは 3 つ:
 *
 *  1. 生成物が原典の「キーワードの形式」と一致するか
 *  2. **原典の 2 か所が食い違っていないか** — `LPI` のページは形式のほかに
 *     「指定できる値は 4、6、8、9、または 12 のいずれかです」と本文でも書いている
 *  3. 既定値が `CRTPRTF` の定義と一致し、原典の値に含まれるか
 *
 * 使い方:  node docs/origin/verify-dds-print-density.mjs
 * 終了コード: 0=OK / 1=不一致
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const DATA = join(ROOT, "vscode-extension/resources/completion/dds-print-density.json");
const CL = join(ROOT, "vscode-extension/resources/prompter/cl/ja/CRTPRTF.json");

const failures = [];
const strip = html =>
  String(html).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

if (!existsSync(DATA)) {
  console.error(`✗ 生成物がありません: ${DATA}`);
  process.exit(1);
}
const data = JSON.parse(readFileSync(DATA, "utf8"));

for (const key of ["cpi", "lpi"]) {
  const name = key.toUpperCase();
  const entry = data[key];
  if (!entry) {
    failures.push(`${name}: 生成物に無い`);
    continue;
  }

  const whole = strip(readFileSync(join(HERE, entry.source), "utf8"));
  const from = whole.indexOf("キーワードの形式");
  const text = from < 0 ? whole : whole.slice(from);

  // 1. 「キーワードの形式」の括弧
  const match = new RegExp(`${name}\\s*\\(([^)]*)\\)`, "u").exec(text);
  const declared = match
    ? match[1].split("|").map(p => p.trim()).filter(p => /^\d+$/u.test(p)).map(Number)
    : [];
  if (declared.length === 0) {
    failures.push(`${name}: 原典の「キーワードの形式」から値を読めない`);
  } else if (JSON.stringify(declared) !== JSON.stringify(entry.values)) {
    failures.push(
      `${name}: 生成物 ${entry.values.join("/")} / 原典の形式 ${declared.join("/")}`
    );
  }

  // 2. 本文の言い回し（あれば）と突き合わせる
  const prose = /指定できる値は\s*([0-9、,\s]+?)\s*のいずれか/u.exec(text);
  if (prose) {
    const inProse = prose[1].split(/[、,\s]+/u).filter(p => /^\d+$/u.test(p)).map(Number);
    if (JSON.stringify(inProse) !== JSON.stringify(entry.values)) {
      failures.push(
        `**原典の 2 か所が食い違う**: ${name} 形式 ${entry.values.join("/")} / 本文 ${inProse.join("/")}`
      );
    }
  }

  // 3. 既定値
  const definition = JSON.parse(readFileSync(CL, "utf8"));
  const found = (definition.parameters ?? []).find(parameter => parameter.name === name);
  const fallback = Number(found?.defaultValue);
  if (!Number.isFinite(fallback)) {
    failures.push(`${name}: CRTPRTF の定義に既定値が無い`);
  } else if (fallback !== entry.default) {
    failures.push(`${name}: 既定値 ${entry.default} / CRTPRTF ${fallback}`);
  } else if (!entry.values.includes(entry.default)) {
    failures.push(`${name}: 既定値 ${entry.default} が値の集合に無い`);
  }
}

console.log("帳票の印刷密度（CPI / LPI）の検査");
for (const key of ["cpi", "lpi"]) {
  const entry = data[key];
  if (entry) console.log(`  ${key.toUpperCase()}: ${entry.values.join(" / ")}（既定 ${entry.default}）`);
}

if (failures.length > 0) {
  console.error(`\n✗ 印刷密度 NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("\n✓ 印刷密度 OK（原典の形式・本文・CRTPRTF の既定が一致）");
