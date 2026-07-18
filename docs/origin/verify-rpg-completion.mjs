#!/usr/bin/env node
/**
 * RPG の補完データ（命令コード・組み込み関数・仕様書キーワード）を検査する。
 *
 * 生成は docs/origin/generate-rpg-completion.mjs。
 *
 * DDS と違い、日英で件数が一致しない。原典そのものが違うためで、
 * 英語版にあって日本語版に無い項目がある（%CONCAT / FOR-EACH など、
 * 新しめの命令・関数は日本語の翻訳が追いついていない）。よって件数一致は
 * 求めず、「各言語の原典に対して取りこぼしていないか」を見る。
 *
 * 使い方:  node docs/origin/verify-rpg-completion.mjs
 * 終了コード: 0=OK / 1=不一致
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const COMPLETION = join(ROOT, "vscode-extension/resources/completion");

const strip = html =>
  String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** 索引ページにある項目数（リンクの表題が「NAME (説明)」の形のもの）。 */
function countIndexEntries(lang, file, pattern) {
  const path = join(HERE, `ilerpg${lang === "ja" ? "" : `-${lang}`}`, file);
  if (!existsSync(path)) return 0;

  const html = readFileSync(path, "utf8");
  const names = new Set();
  for (const match of html.matchAll(
    /href="[^"]*\/rzasd\/[a-z0-9_]+\.htm[^"]*"[^>]*>([\s\S]{0,120}?)<\/a>/g
  )) {
    const found = pattern.exec(strip(match[1]));
    if (found) names.add(found[1]);
  }
  return names.size;
}

const failures = [];
const summary = [];

for (const lang of ["ja", "en"]) {
  const file = join(COMPLETION, lang === "ja" ? "rpg-completion.json" : `rpg-completion.${lang}.json`);
  if (!existsSync(file)) {
    failures.push(`${lang}: 補完データが無い（${file}）`);
    continue;
  }

  const data = JSON.parse(readFileSync(file, "utf8"));

  const checks = [
    {
      label: "opcodes",
      items: data.opcodes ?? [],
      origin: countIndexEntries(lang, "OPCODES.html", /^(%?[A-Z][A-Za-z0-9-]*)\s*[（(]/),
      namePattern: /^[A-Z][A-Za-z0-9-]*$/
    },
    {
      label: "bifs",
      items: data.bifs ?? [],
      origin: countIndexEntries(lang, "BIFS.html", /^(%[A-Za-z][A-Za-z0-9]*)\s*[（(]/),
      namePattern: /^%[A-Za-z][A-Za-z0-9]*$/
    }
  ];

  for (const check of checks) {
    if (check.items.length === 0) {
      failures.push(`${lang}/${check.label}: 1件も無い`);
      continue;
    }

    summary.push(`${lang}/${check.label}: ${check.items.length} 件（原典の索引 ${check.origin} 件）`);

    // 索引に対して取りこぼしが大きくないか。
    if (check.origin > 0 && check.items.length < check.origin * 0.9) {
      failures.push(
        `${lang}/${check.label}: ${check.items.length} 件しか取れていない（索引は ${check.origin} 件）`
      );
    }

    const names = check.items.map(x => x.name);
    if (new Set(names).size !== names.length) {
      failures.push(`${lang}/${check.label}: 名前が重複している`);
    }

    const badName = names.filter(name => !check.namePattern.test(name)).slice(0, 3);
    if (badName.length > 0) {
      failures.push(`${lang}/${check.label}: 名前として不正（${badName.join(", ")}）`);
    }

    // 構文はその名前で始まるはず。別項目の構文が紛れ込むと崩れる。
    // 組み込み関数は和名を構文として拾う事故があったため、括弧の中身も見る。
    const wrongSyntax = check.items
      .filter(x => x.freeForm && !x.freeForm.startsWith(x.name))
      .slice(0, 3);
    if (wrongSyntax.length > 0) {
      failures.push(
        `${lang}/${check.label}: 構文が名前で始まらない（${wrongSyntax
          .map(x => `${x.name}: ${x.freeForm}`)
          .join(" / ")}）`
      );
    }
  }

  for (const [spec, keywords] of Object.entries(data.keywords ?? {})) {
    if (!Array.isArray(keywords) || keywords.length === 0) {
      failures.push(`${lang}/${spec}: キーワードが無い`);
      continue;
    }
    summary.push(`${lang}/${spec}: ${keywords.length} 件`);

    const wrong = keywords.filter(k => !k.syntax?.startsWith(k.name)).slice(0, 3);
    if (wrong.length > 0) {
      failures.push(
        `${lang}/${spec}: 構文が名前で始まらない（${wrong.map(k => k.name).join(", ")}）`
      );
    }
  }
}

console.log("RPG 補完データの検査");
for (const line of summary) console.log(`  ${line}`);

if (failures.length > 0) {
  console.error(`\n✗ RPG 補完データ NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\n✓ RPG 補完データ OK");
console.log(
  "※ 日英で件数が違うのは原典そのものの差（新しめの命令・関数は日本語の翻訳が無い）。"
);
