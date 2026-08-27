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

/**
 * 原典の索引に**名前として書かれている**キーワードを取り出す。
 *
 * リンク数だけを見ていると、**特定の綴りだけが落ちても気付けない**
 * （7 割という下限は 1〜2 件の欠落では割らない）。実際に `CAnn` / `CFnn` が
 * 丸ごと落ちたまま通っていた——DSPF で最も使われる部類の機能キー・キーワードで、
 * `CF03` を書いたソースを開いても補完にもヘルプにも出てこなかった。
 *
 * 抽出は生成側（`generate-dds-keywords.mjs` の `parseTitle`）と**同じ規則**にする。
 * ここが緩いと、生成側の取りこぼしを検査側が追認してしまう。
 */
const TITLE_NAMES = /([A-Z][A-Z0-9]*(?:nn)?(?:\/[A-Z][A-Z0-9]*(?:nn)?)*)\s*[（(]/;

function originKeywordNames(lang, file) {
  const path = join(HERE, `dds${lang === "ja" ? "" : `-${lang}`}`, file);
  if (!existsSync(path)) return new Set();
  const html = readFileSync(path, "utf8");
  const names = new Set();

  for (const match of html.matchAll(
    /<a[^>]*href="[^"]*\/rzak[bcd]\/[a-z0-9_]+\.htm[^"]*"[^>]*>([\s\S]{0,120}?)<\/a>/g
  )) {
    const label = match[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const found = TITLE_NAMES.exec(label);
    if (!found) continue;
    for (const name of found[1].split("/")) {
      if (name.length >= 2) names.add(name);
    }
  }

  return names;
}

const failures = [];

/**
 * 使用レベルの集合。補完はこの値で絞り込むので、知らない値が入ると
 * その語はどのレベルでも出なくなる（絞り込みで必ず外れる）。
 */
const LEVELS = new Set(["file", "record", "field", "key", "join", "select", "help"]);
let unknownLevel = 0;
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
    // `CAnn` / `CFnn` は原典の書き方（CA01-CA24 の総称）なので、小文字の nn を許す。
    const NAME_SHAPE = /^[A-Z][A-Z0-9]*(?:nn)?$/;
    if (names.some(name => !NAME_SHAPE.test(name))) {
      const bad = names.filter(name => !NAME_SHAPE.test(name)).slice(0, 3);
      failures.push(`${lang}/${key}: 名前として不正なもの（${bad.join(", ")}）`);
    }
    if (keywords.some(k => !k.title || k.title.trim().length === 0)) {
      failures.push(`${lang}/${key}: 和名/英名が空のものがある`);
    }

    for (const keyword of keywords) {
      const bad = (keyword.level ?? []).filter(level => !LEVELS.has(level));
      if (bad.length > 0) {
        failures.push(`${lang}/${key}.${keyword.name}: 未知の使用レベル（${bad.join(", ")}）`);
      }
      if (!keyword.level?.length) unknownLevel += 1;
    }

    // 構文はほぼ全件で取れるはず（原典に構文の記載が無いものが少数ある）。
    // 大きく欠けていたら詳細ページの取得漏れか抽出の壊れを疑う。
    const withSyntax = keywords.filter(k => Array.isArray(k.syntax) && k.syntax.length > 0);
    if (withSyntax.length < keywords.length * 0.9) {
      failures.push(
        `${lang}/${key}: 構文が ${withSyntax.length}/${keywords.length} 件しか無い`
      );
    }
    // 構文の先頭はキーワード名で始まるはず（別キーワードの構文が紛れ込むと崩れる）。
    const wrong = withSyntax.filter(k => !k.syntax[0].startsWith(k.name)).slice(0, 3);
    if (wrong.length > 0) {
      failures.push(
        `${lang}/${key}: 構文がキーワード名で始まらない（${wrong.map(k => `${k.name}: ${k.syntax[0]}`).join(" / ")}）`
      );
    }

    // **索引に名前として書かれているものが 1 つでも欠けていないか。**
    // 件数の下限（下の 7 割判定）は 1〜2 件の欠落では割らないので、名前で突き合わせる。
    const originNames = originKeywordNames(lang, originFile);
    const missing = [...originNames].filter(name => !names.includes(name));
    if (missing.length > 0) {
      failures.push(
        `${lang}/${key}: 原典の索引にあるのにデータに無い（${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` ほか ${missing.length - 5} 件` : ""}）`
      );
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
console.log(`  使用レベル不明: ${unknownLevel} 件（どのレベルでも出す扱い）`);
for (const { key } of TYPES) {
  console.log(`  ${key.padEnd(9)} ja=${counts.ja?.[key] ?? "-"}  en=${counts.en?.[key] ?? "-"}`);
}

if (failures.length > 0) {
  console.error(`\n✗ DDS キーワード NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\n✓ DDS キーワード OK");
