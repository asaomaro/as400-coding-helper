#!/usr/bin/env node
/**
 * 定義 JSON を、実機のコマンドオブジェクト由来の定義（GENCMDDOC 出力）と突き合わせる。
 *
 * docs/origin/cl/*.html は IBM Documentation のページ（版に固定された文書）だが、
 * docs/origin/cmddoc/*.HTML は **実機のコマンドオブジェクトから生成**したもので、
 * そのシステムで実際に受け付けられる定義そのもの。両者は版が違えば食い違う。
 *
 * この検査は「文書と定義が合っているか」ではなく「実機と定義が合っているか」を見る。
 * 版差は避けられないため、差分は失敗にせず一覧で報告する（終了コードは常に 0）。
 * 定義の正は原典（docs/origin/cl）のままで、こちらは裏取り用。
 *
 * 取得方法（再取得する場合）:
 *   ssh -p 2222 <user>@pub400.com
 *   system "GENCMDDOC CMD(QSYS/<CMD>) TODIR('/home/<user>/cmddoc')"
 *   scp -P 2222 '<user>@pub400.com:/home/<user>/cmddoc/*.HTML' docs/origin/cmddoc/
 *
 * 使い方:  node docs/origin/verify-cl-against-cmddoc.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const CMDDOC = join(HERE, "cmddoc");
const langArg = process.argv.find(a => a.startsWith("--lang="));
const LANG = langArg ? langArg.slice("--lang=".length) : "ja";
const DEFS = join(ROOT, `vscode-extension/resources/prompter/cl/${LANG}`);

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

/** GENCMDDOC のパラメータ表から、キーワード・必須・省略時値を取り出す。 */
function parseCommandObject(file) {
  const html = readFileSync(file, "utf8");
  const table = html.match(
    /<table[^>]*>\s*<tr>\s*<th[^>]*>Keyword[\s\S]*?<\/table>/i
  );
  if (!table) return null;

  const parameters = [];
  let current = null;

  for (const [, row] of table[0].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    if (cells.length === 0) continue;

    const keyword = cells[0].match(/<b>\s*([A-Z0-9]+)\s*<\/b>/i);
    if (keyword && cells.length >= 4) {
      current = { name: keyword[1], notes: strip(cells[3]), choices: cells[2] };
      parameters.push(current);
    } else if (current && cells.length >= 2) {
      current.choices += ` ${cells[1]}`;
    }
  }

  for (const parameter of parameters) {
    parameter.required = /Required/i.test(parameter.notes);
    // 省略時値は <u> で下線が引かれている。
    parameter.defaultValue = parameter.choices.match(/<u>\s*([^<]+?)\s*<\/u>/i)?.[1];
  }

  return parameters;
}

function* walk(parameter) {
  yield parameter;
  for (const child of parameter.children ?? []) yield* walk(child);
}

/** group の required は末端に落ちて初めて有効になる。 */
const effectiveRequired = parameter =>
  Boolean(parameter.required) || (parameter.children ?? []).some(effectiveRequired);

const findings = { missing: [], extra: [], required: [], defaultValue: [] };
let checked = 0;

for (const file of readdirSync(CMDDOC).filter(name => name.endsWith(".HTML"))) {
  const command = file.replace(/^QSYS_/, "").replace(/\.HTML$/, "");
  const definitionPath = join(DEFS, `${command}.json`);
  if (!existsSync(definitionPath)) continue;

  const real = parseCommandObject(join(CMDDOC, file));
  if (!real) continue;

  checked += 1;
  const definition = JSON.parse(readFileSync(definitionPath, "utf8"));
  const defined = new Map((definition.parameters ?? []).map(p => [p.name, p]));
  const realNames = new Set(real.map(p => p.name));

  for (const parameter of real) {
    if (!defined.has(parameter.name)) {
      findings.missing.push(`${command}.${parameter.name}`);
      continue;
    }

    const target = defined.get(parameter.name);
    if (parameter.required !== effectiveRequired(target)) {
      findings.required.push(
        `${command}.${parameter.name}（実機=${parameter.required ? "必須" : "任意"}）`
      );
    }

    if (
      parameter.defaultValue &&
      ![...walk(target)].some(p => p.defaultValue === parameter.defaultValue)
    ) {
      findings.defaultValue.push(
        `${command}.${parameter.name} = ${parameter.defaultValue}`
      );
    }
  }

  for (const name of defined.keys()) {
    if (!realNames.has(name)) findings.extra.push(`${command}.${name}`);
  }
}

const labels = {
  missing: "実機にあり定義に無い（版差の可能性）",
  extra: "定義にあり実機に無い",
  required: "required が実機と異なる",
  defaultValue: "省略時値が実機と異なる"
};

console.log(`実機のコマンド定義と照合: ${checked} コマンド`);
for (const [key, label] of Object.entries(labels)) {
  const items = findings[key];
  console.log(`\n## ${label}: ${items.length} 件`);
  items.slice(0, 30).forEach(item => console.log(`  - ${item}`));
  if (items.length > 30) console.log(`  ... 他 ${items.length - 30} 件`);
}

console.log(
  "\n※ 定義の正は原典（docs/origin/cl、IBM i 7.4 文書）。実機は 7.5 のため版差は避けられない。" +
    "\n   この検査は裏取り用で、差分があっても失敗にはしない。"
);
