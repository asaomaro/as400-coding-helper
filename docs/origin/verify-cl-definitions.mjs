#!/usr/bin/env node
/**
 * 原典HTML(docs/origin/cl/*.html) と プロンプター定義 JSON を機械的に突き合わせる検査。
 * generate-cl-definitions.mjs の受け入れテストとして使う。
 *
 * 検査内容:
 *   - パラメータ集合が原典と一致するか（欠落 / 余分）
 *   - required が原典のノーツ欄と一致するか（group は末端に落ちて初めて有効）
 *   - 省略時値（原典の下線付き値）が defaultValue に入っているか
 *   - 定義済み値(*XXX)が JSON のどこかに現れるか
 *   - 入力欄の名前がコマンド内で一意か（重複すると値が共有されてしまう）
 *
 * 使い方:
 *   node docs/origin/verify-cl-definitions.mjs            # 全件、差分があれば終了コード1
 *   node docs/origin/verify-cl-definitions.mjs ADDLIBLE   # 個別
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
// 言語ごとに原典と定義を分けている。既定は日本語。
const langArg = process.argv.find(a => a.startsWith("--lang="));
const LANG = langArg ? langArg.slice("--lang=".length) : "ja";
const HTML_DIR = path.join(ROOT, `docs/origin/cl${LANG === "ja" ? "" : `-${LANG}`}`);
const JSON_DIR = path.join(ROOT, `vscode-extension/resources/prompter/cl/${LANG}`);

const decode = text =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const stripTags = html =>
  decode(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const matchAll = (text, re) => [...String(text).matchAll(re)];

/** 原典のパラメータ表から、突き合わせに使う事実だけを取り出す。 */
function parseOrigin(html) {
  const table =
    html.match(/<table[^>]*summary="Parameters"[^>]*>([\s\S]*?)<\/table>/i) ||
    [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].find(m =>
      /<th[^>]*>[\s\S]{0,120}?(Keyword|キーワード)[\s\S]{0,120}?<\/th>/i.test(m[1])
    );
  if (!table) return null;

  const params = [];
  let current = null;

  for (const [, row] of matchAll(table[1], /<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = matchAll(row, /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi).map(m => m[1]);
    if (cells.length === 0 || /<th/i.test(row)) continue;

    const keyword = cells[0].match(/<strong>\s*([A-Z0-9]+)\s*<\/strong>/i);
    if (keyword && cells.length >= 4) {
      const notes = stripTags(cells[3]);
      // 選択項目が「コマンド・ストリング」だけの欄は、値そのものがコマンド
      // （プロンプター内でさらにプロンプターを開ける）。継続行を足す前に見る。
      const choices = stripTags(cells[2]).trim();
      current = {
        name: keyword[1],
        required: /必須|Required/i.test(notes),
        commandValued: choices === "コマンド・ストリング" || choices === "Command string",
        html: cells[2]
      };
      params.push(current);
    } else if (current && cells.length >= 2) {
      current.html += ` ${cells[1]}`;
    }
  }

  for (const param of params) {
    param.defaultValue =
      param.html.match(/<strong class="underlined">\s*([^<\s][^<]*?)\s*<\/strong>/i)?.[1] ??
      param.html.match(/<u>\s*([^<\s][^<]*?)\s*<\/u>/i)?.[1];
    param.specials = [...new Set(matchAll(stripTags(param.html), /\*[A-Z0-9]+/g).map(m => m[0]))];
  }

  return params;
}

function* walk(parameters) {
  for (const parameter of parameters ?? []) {
    yield parameter;
    yield* walk(parameter.children);
  }
}

const leaves = parameters =>
  [...walk(parameters)].filter(p => !(p.inputType === "group" && p.children?.length));

/** group の required は末端に落ちて初めて検証されるため、子孫まで見る。 */
const effectiveRequired = parameter =>
  Boolean(parameter.required) || (parameter.children ?? []).some(effectiveRequired);

const findings = [];
const report = (kind, detail) => findings.push({ kind, detail });

const targets = process.argv.slice(2).filter(a => !a.startsWith("--"));
const commands = (
  targets.length > 0
    ? targets
    : fs.readdirSync(JSON_DIR).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5))
).filter(cmd => fs.existsSync(path.join(HTML_DIR, `${cmd}.html`)));

let checked = 0;

for (const command of commands) {
  const origin = parseOrigin(fs.readFileSync(path.join(HTML_DIR, `${command}.html`), "utf8"));
  const definition = JSON.parse(
    fs.readFileSync(path.join(JSON_DIR, `${command}.json`), "utf8")
  );
  const parameters = definition.parameters ?? [];

  // 入力欄の名前はフォームのキー。重複すると複数の欄が同じ値を共有する。
  const seen = new Set();
  for (const leaf of leaves(parameters)) {
    if (seen.has(leaf.name)) report("名前重複", `${command}.${leaf.name}`);
    seen.add(leaf.name);
  }

  if (!origin) {
    if (parameters.length > 0) {
      report("原典に表が無いのにパラメータあり", command);
    }
    continue;
  }

  checked += 1;
  const blob = JSON.stringify(definition);
  const topLevel = new Map(parameters.map(p => [p.name, p]));

  for (const name of topLevel.keys()) {
    if (!origin.some(p => p.name === name)) report("原典に無いパラメータ", `${command}.${name}`);
  }

  for (const param of origin) {
    const target = topLevel.get(param.name);
    if (!target) {
      report("パラメータ欠落", `${command}.${param.name}`);
      continue;
    }

    if (param.required !== effectiveRequired(target)) {
      report(
        "required不一致",
        `${command}.${param.name} 原典=${param.required ? "必須" : "任意"}`
      );
    }

    if (param.defaultValue && ![...walk([target])].some(p => p.defaultValue === param.defaultValue)) {
      report("defaultValue欠落", `${command}.${param.name} = ${param.defaultValue}`);
    }

    if (param.commandValued !== (target.valueKind === "command")) {
      report(
        "valueKind不一致",
        `${command}.${param.name} 原典=${param.commandValued ? "コマンド" : "通常"}`
      );
    }

    const missing = param.specials.filter(value => !blob.includes(value));
    if (missing.length > 0) {
      report("定義済み値の欠落", `${command}.${param.name}: ${missing.join(" ")}`);
    }
  }
}

const byKind = new Map();
for (const { kind, detail } of findings) {
  if (!byKind.has(kind)) byKind.set(kind, []);
  byKind.get(kind).push(detail);
}

console.log(`検査対象: ${commands.length} コマンド（パラメータ表あり: ${checked}）`);
for (const [kind, details] of byKind) {
  console.log(`\n## ${kind}: ${details.length} 件`);
  details.slice(0, 40).forEach(detail => console.log(`  - ${detail}`));
  if (details.length > 40) console.log(`  ... 他 ${details.length - 40} 件`);
}

if (findings.length === 0) {
  console.log("\n原典との差分はありません。");
}

process.exit(findings.length === 0 ? 0 : 1);
