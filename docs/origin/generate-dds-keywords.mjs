#!/usr/bin/env node
/**
 * DDS のキーワード（45-80 桁の機能欄）を原典から抽出して補完データにする。
 *
 * 原典はファイル種別ごとに索引ページがあり、各キーワードへのリンクと
 * 1〜2文の説明が並んでいる:
 *   docs/origin/dds/PF-LF-KEYWORDS.html   物理/論理
 *   docs/origin/dds/DSPF-KEYWORDS.html    表示装置
 *   docs/origin/dds/PRTF-KEYWORDS.html    印刷装置
 *
 * リンクの表題は「表示装置ファイルの ALARM (音響警報) キーワード」の形なので、
 * ここからキーワード名と和名を取り、直後の説明文を添える。
 *
 * 説明文には「これはレコード・レベル・キーワードで…」のように、どのレベル
 * （ファイル/レコード/フィールド/ヘルプ/キー）で使えるかが書かれている。
 * 補完の絞り込みに使えるので、判別できる範囲で拾う。
 *
 * 出力: resources/completion/dds-keywords{.lang}.json
 *   { "DDS-PF": [{ name, title, level, description }], ... }
 *
 * 使い方:  node docs/origin/generate-dds-keywords.mjs [--lang=en]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

const langArg = process.argv.find(a => a.startsWith("--lang="));
const LANG = langArg ? langArg.slice("--lang=".length) : "ja";
const ORIGIN = join(HERE, `dds${LANG === "ja" ? "" : `-${LANG}`}`);
const OUT = join(ROOT, "vscode-extension/resources/completion");

const TYPES = [
  { key: "DDS-PF", file: "PF-LF-KEYWORDS.html" },
  { key: "DDS-DSPF", file: "DSPF-KEYWORDS.html" },
  { key: "DDS-PRTF", file: "PRTF-KEYWORDS.html" }
];

const decode = text =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const strip = html =>
  decode(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/**
 * 索引の1項目は <li class="…ulchildlink…"> … </li>。
 * 説明文の入れ物はページによって違い、<span class="ph"> で包む版（表示装置）と
 * 素のテキストの版（印刷装置）がある。項目を <li> 単位で切り出したうえで、
 * リンク表題より後ろを説明として扱えば、どちらでも取れる。
 * （項目をまたいで拾うと、隣のキーワードの説明が付く。実際に ABSVAL に
 *   ALIAS の説明が付いていた）
 */
// li のクラス名は言語版で異なる（日本語版は ulchildlink が付くが英語版は付かない）。
// キーワード詳細ページへのリンクを起点にし、そこから次のリンクの手前までを
// 1項目として切り出す。これなら li の書き方に依存しない。
const KEYWORD_LINK = /<a[^>]*href="[^"]*\/(rzak[bcd])\/[a-z0-9_]+\.htm[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

/**
 * 表題からキーワード名と和名を取る。
 *   「表示装置ファイルの ALARM (音響警報) キーワード」→ ALARM / 音響警報
 *   「ALL (すべて) キーワード - 論理ファイルのみ」    → ALL / すべて
 *   「ALTPAGEDWN/ALTPAGEUP (代替次ページ…) キーワード」→ 2件に分ける
 */
function parseTitle(title) {
  const match = /([A-Z][A-Z0-9]*(?:\/[A-Z][A-Z0-9]*)*)\s*[（(]([^)）]*)[）)]/.exec(title);
  if (!match) return [];

  const label = match[2].trim();
  return match[1]
    .split("/")
    .map(name => name.trim())
    .filter(name => name.length >= 2)
    .map(name => ({ name, title: label }));
}

/** 説明文から使用レベルを拾う（分かる範囲で。判別できなければ undefined）。 */
function parseLevel(description) {
  const levels = [];
  if (/ファイル・レベル|file-level/i.test(description)) levels.push("file");
  if (/レコード・レベル|record-level/i.test(description)) levels.push("record");
  if (/フィールド・レベル|field-level/i.test(description)) levels.push("field");
  if (/ヘルプ・レベル|help-level/i.test(description)) levels.push("help");
  if (/キー・レベル|key-level/i.test(description)) levels.push("key");
  if (/結合レベル|join-level/i.test(description)) levels.push("join");
  return levels.length > 0 ? levels : undefined;
}

const result = {};

for (const { key, file } of TYPES) {
  const html = readFileSync(join(ORIGIN, file), "utf8");
  const byName = new Map();

  const links = [...html.matchAll(KEYWORD_LINK)];

  for (const [index, link] of links.entries()) {
    const title = strip(link[2]);
    // リンク直後から次のリンクの手前までが説明。項目をまたいで拾うと
    // 隣のキーワードの説明が付く（実際に ABSVAL に ALIAS の説明が付いていた）。
    const from = link.index + link[0].length;
    const to = links[index + 1]?.index ?? Math.min(from + 1200, html.length);
    const description = strip(html.slice(from, to)).slice(0, 400);

    for (const { name, title: label } of parseTitle(title)) {
      // 同じキーワードが複数の索引項目に出ることがある。先に出た方を採る。
      if (byName.has(name)) continue;
      byName.set(name, {
        name,
        title: label,
        ...(parseLevel(description) ? { level: parseLevel(description) } : {}),
        ...(description ? { description } : {})
      });
    }
  }

  const keywords = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (keywords.length === 0) {
    console.error(`✗ ${key}: キーワードが1件も取れなかった（${file}）`);
    process.exit(1);
  }

  result[key] = keywords;
  const withLevel = keywords.filter(k => k.level).length;
  console.log(`${key}: ${keywords.length} 件（レベル判別 ${withLevel} 件）`);
}

mkdirSync(OUT, { recursive: true });
const suffix = LANG === "ja" ? "" : `.${LANG}`;
writeFileSync(
  join(OUT, `dds-keywords${suffix}.json`),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8"
);
console.log(`\n出力: resources/completion/dds-keywords${suffix}.json`);
