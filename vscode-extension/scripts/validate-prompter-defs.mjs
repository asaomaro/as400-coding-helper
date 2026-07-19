#!/usr/bin/env node
// プロンプター定義 JSON の構造検証ツール。
// resources/prompter/{cl,cmd,rpg/**}/*.json を走査し、src/prompter/types.ts の
// PrompterDefinition / ParameterDefinition 形に適合するか機械チェックする。
//
// ローダー（jsonDefinitions.ts）は不正 JSON を console ログのみでスキップする
// （＝壊れた定義は「F4 候補に黙って出ない」形で劣化する）ため、CI/ローカルで
// 事前に構造健全性を担保し、壊れた定義を deliver させない硬いゲートとして使う。
//
// 使い方:  node scripts/validate-prompter-defs.mjs [追加の探索ルート ...]
// 終了コード: 0=全件OK / 1=1件以上のエラー

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const INPUT_TYPES = new Set(["text", "dropdown", "number", "group"]);
const CHAR_SETS = new Set(["alpha", "alnum", "upper", "any"]);

/** 再帰的に *.json を集める */
function collectJsonFiles(root) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) out.push(...collectJsonFiles(p));
    else if (e.isFile() && e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

const errors = [];
const err = (file, msg) => errors.push(`${relative(repoRoot, file)}: ${msg}`);

function validateParameter(param, file, path) {
  if (typeof param !== "object" || param === null || Array.isArray(param)) {
    err(file, `${path} はオブジェクトである必要があります`);
    return;
  }
  if (typeof param.name !== "string" || param.name.length === 0)
    err(file, `${path}.name は非空文字列が必要です`);
  if (typeof param.description !== "string")
    err(file, `${path}.description は文字列が必要です`);
  if (!INPUT_TYPES.has(param.inputType))
    err(file, `${path}.inputType は ${[...INPUT_TYPES].join("|")} のいずれか（実際: ${JSON.stringify(param.inputType)}）`);
  if (typeof param.required !== "boolean")
    err(file, `${path}.required は boolean が必要です`);
  if (param.help !== undefined && typeof param.help !== "string")
    err(file, `${path}.help は文字列が必要です`);

  // attributes
  if (param.attributes !== undefined) {
    const a = param.attributes;
    if (typeof a !== "object" || a === null)
      err(file, `${path}.attributes はオブジェクトが必要です`);
    else {
      if (a.characterSet !== undefined && !CHAR_SETS.has(a.characterSet))
        err(file, `${path}.attributes.characterSet は ${[...CHAR_SETS].join("|")} のいずれか`);
      for (const k of ["minLength", "maxLength"])
        if (a[k] !== undefined && typeof a[k] !== "number")
          err(file, `${path}.attributes.${k} は数値が必要です`);
      if (a.numericOnly !== undefined && typeof a.numericOnly !== "boolean")
        err(file, `${path}.attributes.numericOnly は boolean が必要です`);
    }
  }

  // group は children を持つべき
  if (param.inputType === "group") {
    if (!Array.isArray(param.children) || param.children.length === 0)
      err(file, `${path}.inputType="group" は非空の children が必要です`);
  }
  // dropdown は options を持つべき
  if (param.inputType === "dropdown") {
    if (!Array.isArray(param.options) || param.options.length === 0)
      err(file, `${path}.inputType="dropdown" は非空の options が必要です`);
  }

  // options
  if (param.options !== undefined) {
    if (!Array.isArray(param.options))
      err(file, `${path}.options は配列が必要です`);
    else
      param.options.forEach((o, i) => {
        if (typeof o !== "object" || o === null || typeof o.label !== "string" || typeof o.value !== "string")
          err(file, `${path}.options[${i}] は {label, value}(文字列) が必要です`);
      });
  }

  // 数値系の任意キー
  for (const k of ["maxOccurrences", "length", "sourceStart", "sourceLength"])
    if (param[k] !== undefined && typeof param[k] !== "number")
      err(file, `${path}.${k} は数値が必要です`);

  // children 再帰
  if (param.children !== undefined) {
    if (!Array.isArray(param.children))
      err(file, `${path}.children は配列が必要です`);
    else param.children.forEach((c, i) => validateParameter(c, file, `${path}.children[${i}]`));
  }
}

function validateDefinition(def, file) {
  if (typeof def !== "object" || def === null || Array.isArray(def)) {
    err(file, "トップレベルは JSON オブジェクトが必要です");
    return;
  }
  if (typeof def.keyword !== "string" || def.keyword.length === 0)
    err(file, "keyword は非空文字列が必要です");
  if (typeof def.description !== "string")
    err(file, "description は文字列が必要です");
  if (def.help !== undefined && typeof def.help !== "string")
    err(file, "help は文字列が必要です");
  if (!Array.isArray(def.parameters))
    err(file, "parameters は配列が必要です（パラメータ無しは [] ）");
  else def.parameters.forEach((p, i) => validateParameter(p, file, `parameters[${i}]`));
}

// 探索ルート: 既定は resources/prompter 配下。引数で追加可能。
const roots =
  process.argv.length > 2
    ? process.argv.slice(2)
    : [join(repoRoot, "resources", "prompter", "cl"), join(repoRoot, "resources", "prompter", "rpg")];

let files = [];
for (const r of roots) {
  try {
    if (statSync(r).isDirectory()) files.push(...collectJsonFiles(r));
    else files.push(r);
  } catch {
    // ルート不在は無視（rpg ディレクトリ未作成など）
  }
}

let parsed = 0;
for (const f of files) {
  let json;
  try {
    json = JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    err(f, `JSON パース失敗: ${e.message}`);
    continue;
  }
  parsed++;
  validateDefinition(json, f);
}

if (errors.length > 0) {
  console.error(`✗ プロンプター定義の構造検証 NG（${errors.length}件）`);
  for (const e of errors) console.error("  - " + e);
  console.error(`\n検査ファイル数: ${files.length}（パース成功 ${parsed}）`);
  process.exit(1);
}

console.log(`✓ プロンプター定義の構造検証 OK（${files.length} ファイル全件適合）`);
