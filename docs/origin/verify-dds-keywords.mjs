#!/usr/bin/env node
/**
 * DDS のキーワード補完データが原典と整合しているかを検査する。
 *
 * 生成は docs/origin/generate-dds-keywords.mjs。原典の索引ページに並ぶ
 * キーワード詳細ページへのリンク数と、抽出できた件数を突き合わせる。
 * 索引には「サポートされているキーワード」のような、キーワードでない
 * リンクも混ざるため完全一致は求めず、取りこぼしが大きくないかを見る。
 *
 * あわせて、補完データとして壊れていないか（名前の重複・空の説明・
 * 日英で件数が食い違う）を確認する。日英で件数が違うと、言語を切り替えた
 * ときに候補が増減してしまう。
 *
 * 使い方:  node docs/origin/verify-dds-keywords.mjs
 * 終了コード: 0=OK / 1=不一致
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const COMPLETION = join(ROOT, "vscode-extension/resources/completion");

const TYPES = [
  { key: "DDS-PF", file: "PF-LF-KEYWORDS.html" },
  { key: "DDS-DSPF", file: "DSPF-KEYWORDS.html" },
  { key: "DDS-PRTF", file: "PRTF-KEYWORDS.html" }
];

/** 原典の索引にあるキーワード詳細ページへのリンク数。 */
function countOriginLinks(lang, file) {
  const path = join(HERE, `dds${lang === "ja" ? "" : `-${lang}`}`, file);
  if (!existsSync(path)) return 0;
  const html = readFileSync(path, "utf8");
  return [...html.matchAll(/<a[^>]*href="[^"]*\/rzak[bcd]\/[a-z0-9_]+\.htm[^"]*"/g)].length;
}

const failures = [];
const counts = {};

for (const lang of ["ja", "en"]) {
  const file = join(COMPLETION, lang === "ja" ? "dds-keywords.json" : `dds-keywords.${lang}.json`);
  if (!existsSync(file)) {
    failures.push(`${lang}: 補完データが無い（${file}）`);
    continue;
  }

  const data = JSON.parse(readFileSync(file, "utf8"));
  counts[lang] = {};

  for (const { key, file: originFile } of TYPES) {
    const keywords = data[key];
    if (!Array.isArray(keywords) || keywords.length === 0) {
      failures.push(`${lang}/${key}: キーワードが無い`);
      continue;
    }

    counts[lang][key] = keywords.length;

    const names = keywords.map(k => k.name);
    if (new Set(names).size !== names.length) {
      failures.push(`${lang}/${key}: キーワード名が重複している`);
    }
    if (names.some(name => !/^[A-Z][A-Z0-9]*$/.test(name))) {
      const bad = names.filter(name => !/^[A-Z][A-Z0-9]*$/.test(name)).slice(0, 3);
      failures.push(`${lang}/${key}: 名前として不正なもの（${bad.join(", ")}）`);
    }
    if (keywords.some(k => !k.title || k.title.trim().length === 0)) {
      failures.push(`${lang}/${key}: 和名/英名が空のものがある`);
    }

    // 索引のリンク数に対して取りこぼしが大きくないか（キーワード以外の
    // リンクも混ざるため 7 割を下限とする）。
    const links = countOriginLinks(lang, originFile);
    if (links > 0 && keywords.length < links * 0.7) {
      failures.push(
        `${lang}/${key}: 抽出できたのが ${keywords.length} 件（原典のリンクは ${links} 件）。取りこぼしの疑い`
      );
    }
  }
}

// 日英で件数が違うと、言語を切り替えたときに候補が増減する。
for (const { key } of TYPES) {
  const ja = counts.ja?.[key];
  const en = counts.en?.[key];
  if (ja !== undefined && en !== undefined && ja !== en) {
    failures.push(`${key}: 件数が日英で違う（ja=${ja} / en=${en}）`);
  }
}

console.log("DDS キーワード補完データの検査");
for (const { key } of TYPES) {
  console.log(`  ${key.padEnd(9)} ja=${counts.ja?.[key] ?? "-"}  en=${counts.en?.[key] ?? "-"}`);
}

if (failures.length > 0) {
  console.error(`\n✗ DDS キーワード NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\n✓ DDS キーワード OK");
