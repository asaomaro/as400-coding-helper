#!/usr/bin/env node
/**
 * ILE RPG 仕様書プロンプターの**選択欄の値**を、原典の桁ごとのページから入れる。
 *
 * 仕様書のレイアウトのページ（`F-SPEC-layout.html` など）は桁とラベルしか持たず、
 * **書ける値は桁ごとの詳細ページ**（`f18.htm` / `d40.htm` …）の「記入 / 説明」の定義リストにある。
 * 以前は値を手で書いており、D 仕様のデータ・タイプに `N`・`G`・`C`・`U`・`O`・`*` が無く、
 * F 仕様のファイル指定に `P`・`S`・`R`・`T` が無かった（2026-09-27 の実操作調査 P8。
 * INDDS の標識サブフィールドの `N` を手で打つしかなかった）。
 *
 * - 日本語版の定義（`resources/prompter/rpg/ile/ja/`）の options を、日本語のページの値と説明で置き換える。
 * - 英語版の定義は `generate-rpg-spec-definitions.mjs` が訳文ファイルから作るので、訳文ファイル
 *   （`rpg-spec-en-strings.json`）の options のラベルを英語のページから入れる。値は日英で同じであることを確かめる。
 *
 * 値の読み方: `<dt>` の語が値。`ブランク` / `Blank` は空、`A またはブランク` / `A or blank` は 2 つの値。
 * ラベルは「値 ＋ 説明の最初の句」（括弧・句点の手前まで）。
 *
 * 使い方:  node docs/origin/generate-rpg-position-values.mjs          # 書く
 *          node docs/origin/generate-rpg-position-values.mjs --check  # 書かずに一致を見る（差分があれば終了コード 1）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const DEFS = join(ROOT, "vscode-extension/resources/prompter/rpg/ile/ja");
const STRINGS = join(HERE, "rpg-spec-en-strings.json");
const CHECK = process.argv.includes("--check");

/** 欄 → 桁ごとのページ。 */
const TARGETS = [
  { spec: "F-SPEC", parameter: "FILETYPE", page: "F-POS-17" },
  { spec: "F-SPEC", parameter: "FILEDESG", page: "F-POS-18" },
  { spec: "F-SPEC", parameter: "ENDFILE", page: "F-POS-19" },
  { spec: "F-SPEC", parameter: "FILEADD", page: "F-POS-20" },
  { spec: "F-SPEC", parameter: "SEQUENCE", page: "F-POS-21" },
  { spec: "F-SPEC", parameter: "FILEFMT", page: "F-POS-22" },
  { spec: "F-SPEC", parameter: "LIMITS", page: "F-POS-28" },
  { spec: "F-SPEC", parameter: "RECADDR", page: "F-POS-34" },
  { spec: "F-SPEC", parameter: "FILEORG", page: "F-POS-35" },
  { spec: "D-SPEC", parameter: "INTTYPE", page: "D-POS-40" }
];

const plain = html =>
  String(html)
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();

/** 「記入 / 説明」の定義リストから [値, 説明] を読む。見出しの行（dthd）は飛ばす。 */
function readEntries(file) {
  const html = readFileSync(file, "utf8");
  // 日英でクラス名が違う（ja `dl` / `dt dlterm` / `dd`、en クラス無し / `dlterm` / `dlentry`）。クラス名に頼らない。
  const list = /<dl[^>]*>\s*<dt class="dthd">([\s\S]*?)<\/dl>/u.exec(html);
  if (!list) throw new Error(`${file}: 記入 / 説明の定義リストが無い`);
  const entries = [];
  for (const match of list[1].matchAll(/<dt class="[^"]*dlterm[^"]*">([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gu)) {
    const term = plain(match[1]);
    const description = plain(match[2]);
    for (const part of term.split(/\s*(?:または|or)\s*/u)) {
      const value = /^(?:ブランク|Blank)$/iu.test(part) ? "" : part;
      if (!/^(?:[A-Z]|\*)?$/u.test(value)) throw new Error(`${file}: 値として読めない語 "${part}"`);
      entries.push({ value, description });
    }
  }
  if (entries.length === 0) throw new Error(`${file}: 値が 1 つも無い`);
  return entries;
}

/**
 * 説明の最初の文。40 文字を超えるなら括弧・読点の手前まで、それでも長ければ切る。
 * 括弧の中が区別に効く値がある（D の `B 数値 (2 進数形式)` と `P 数値 (パック 10 進数形式)`）ので、短い文は括弧ごと残す。
 */
function headline(description) {
  const sentence = description.split(/。|\.\s|\.$/u)[0].trim();
  if (sentence.length <= 40) return sentence;
  const clause = sentence.split(/[（(、,]/u)[0].trim();
  return clause.length >= 2 && clause.length <= 40 ? clause : `${sentence.slice(0, 40)}…`;
}

const label = (value, description, blank) => `${value === "" ? blank : value} ${headline(description)}`.trim();

const strings = JSON.parse(readFileSync(STRINGS, "utf8"));
const definitions = new Map();
const differences = [];

for (const target of TARGETS) {
  const ja = readEntries(join(HERE, "ilerpg", `${target.page}.html`));
  const en = readEntries(join(HERE, "ilerpg-en", `${target.page}.html`));
  const jaValues = ja.map(e => e.value).join(",");
  const enValues = en.map(e => e.value).join(",");
  if (jaValues !== enValues) throw new Error(`${target.page}: 日英で値が違う（ja ${jaValues} / en ${enValues}）`);

  if (!definitions.has(target.spec)) {
    definitions.set(target.spec, JSON.parse(readFileSync(join(DEFS, `${target.spec}.json`), "utf8")));
  }
  const parameter = definitions.get(target.spec).parameters.find(p => p.name === target.parameter);
  if (!parameter) throw new Error(`${target.spec}.${target.parameter} が定義に無い`);

  const options = ja.map(e => ({ label: label(e.value, e.description, "（ブランク）"), value: e.value }));
  if (JSON.stringify(parameter.options) !== JSON.stringify(options) || parameter.inputType !== "dropdown") {
    differences.push(`${target.spec}.${target.parameter}: ${JSON.stringify((parameter.options ?? []).map(o => o.value))} → ${JSON.stringify(options.map(o => o.value))}`);
  }
  parameter.inputType = "dropdown";
  parameter.options = options;

  const text = (strings[target.spec][target.parameter] ??= { description: target.parameter });
  const enOptions = Object.fromEntries(en.map(e => [e.value, label(e.value, e.description, "(blank)")]));
  if (JSON.stringify(text.options) !== JSON.stringify(enOptions)) {
    differences.push(`rpg-spec-en-strings ${target.spec}.${target.parameter}.options`);
  }
  text.options = enOptions;
}

if (CHECK) {
  if (differences.length > 0) {
    console.error("原典の値と定義が食い違う。generate-rpg-position-values.mjs を流し直すこと:");
    for (const line of differences) console.error(`  - ${line}`);
    process.exit(1);
  }
  console.log(`✓ RPG の選択欄の値は原典と一致（${TARGETS.length} 欄）`);
} else {
  for (const [spec, definition] of definitions) {
    writeFileSync(join(DEFS, `${spec}.json`), `${JSON.stringify(definition, null, 2)}\n`, "utf8");
  }
  writeFileSync(STRINGS, `${JSON.stringify(strings, null, 2)}\n`, "utf8");
  console.log(`書き換えた欄: ${differences.length}`);
  for (const line of differences) console.log(`  - ${line}`);
}
