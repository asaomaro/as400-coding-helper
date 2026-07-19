#!/usr/bin/env node
/**
 * すべてのプロンプター定義で往復（コード → 入力欄 → コード）を確かめる。
 *
 * 既存の往復検証は原典の使用例が要るため、例の無い定義は素通りしていた。
 * ここでは定義そのものから入力値を作るので、例の有無に関係なく全件を回せる。
 * 対象は CL / .cmd（キーワード方式）と RPG / DDS（桁方式）の全定義。
 *
 * 見るのは 2 つ:
 *   1. 何も変えずに確定して、元のコードと一致すること（桁が崩れない）
 *   2. 値を入れて確定 → 読み直しで、同じ値が返ること（値が失われない）
 *
 * 使い方:  node scripts/verify-prompter-roundtrip.mjs
 * 終了コード: 0=OK / 1=不一致
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Module, { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// vscode API は使わない部分だけを読むためのスタブ。
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "vscode") {
    return {
      Range: class {},
      Position: class {},
      WorkspaceEdit: class {},
      workspace: { getConfiguration: () => ({ get: () => undefined }) },
      window: {}
    };
  }
  return originalLoad.call(this, request, ...rest);
};

const require = createRequire(import.meta.url);
const OUT = join(root, "out/prompter");
const { buildClCommandText, buildRpgLineText } = require(join(OUT, "applyChanges"));
const { parseClCommand, joinContinuationLines, mapParsedCommandToValues } =
  require(join(OUT, "clCommandParser"));
const { extractByColumns } = require(join(OUT, "initialValues"));

const failures = [];
const fail = (label, detail) => failures.push(`${label}: ${detail}`);

/** 末端の入力欄だけを取り出す（group は入力欄を持たない）。 */
function* leaves(parameters) {
  for (const parameter of parameters ?? []) {
    if (parameter.children?.length) yield* leaves(parameter.children);
    else yield parameter;
  }
}

/**
 * 定義から入力値を作る。
 * 選択肢があればその値、数値欄なら数字、それ以外は英字。桁幅に収める。
 */
function sampleValue(parameter) {
  const option = (parameter.options ?? []).find(o => o.value && o.value.trim().length > 0);
  if (option) return option.value;

  const width = parameter.sourceLength ?? parameter.attributes?.maxLength ?? 3;
  const numeric =
    parameter.inputType === "number" || parameter.attributes?.numericOnly === true;

  return numeric ? "1".padStart(Math.min(width, 1), "1") : "ABC".slice(0, Math.max(1, Math.min(3, width)));
}

// ---------------------------------------------------------- キーワード方式（CL / .cmd）

function checkKeywordStyle(label, definition) {
  const values = {};
  for (const leaf of leaves(definition.parameters)) {
    values[leaf.name] = sampleValue(leaf);
  }

  const present = definition.parameters.map(p => p.name);
  const text = buildClCommandText(definition, values, { presentParameters: present });

  const parsed = parseClCommand(joinContinuationLines(text.split("\n")));
  if (!parsed) {
    fail(label, `組み立てた行を読み直せない\n      ${text.trim()}`);
    return;
  }
  if (parsed.keyword !== definition.keyword.toUpperCase()) {
    fail(label, `読み直すと命令名が変わる（${parsed.keyword}）`);
    return;
  }

  const second = mapParsedCommandToValues(definition, parsed);
  const rebuilt = buildClCommandText(definition, second, {
    presentParameters: Object.keys(parsed.parameters)
  });

  if (rebuilt !== text) {
    fail(label, `2 回目の確定で変わる\n      1回目: ${text.trim()}\n      2回目: ${rebuilt.trim()}`);
    return;
  }

  // 72 桁を超える行を作らないこと（CL ソースの折り返し）。
  const long = text.split("\n").find(line => line.length > 72);
  if (long) fail(label, `72 桁を超える行がある\n      ${long}`);
}

// ------------------------------------------------------------- 桁方式（RPG / DDS）

/** 仕様書コード（6 桁目）。定義のキーから決まる。 */
function specChar(key) {
  if (key.startsWith("DDS-")) return "A";
  if (key === "C-NEW") return "C";
  return key.charAt(0);
}

function checkColumnStyle(label, key, definition) {
  const positional = definition.parameters.filter(p => p.sourceStart);
  if (positional.length === 0) return; // H 仕様書はキーワード方式

  const width = Math.max(...positional.map(p => p.sourceStart + p.sourceLength - 1), 80);
  const cells = new Array(width).fill(" ");
  cells[5] = specChar(key);

  // 桁が重なっている欄があると、片方に入力すると他方が壊れる。
  // 読み戻しも曖昧になるので、重なり自体を欠陥として扱う。
  const sorted = [...positional].sort((a, b) => a.sourceStart - b.sourceStart);
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const end = previous.sourceStart + previous.sourceLength - 1;
    if (sorted[i].sourceStart <= end) {
      fail(label, `桁が重なっている（${previous.name} ${previous.sourceStart}-${end} と ${sorted[i].name} ${sorted[i].sourceStart} 桁目）`);
      return;
    }
  }

  const values = {};
  for (const parameter of positional) {
    const value = sampleValue(parameter);
    values[parameter.name] = value;

    const numeric =
      parameter.inputType === "number" || parameter.attributes?.numericOnly === true;
    const padded = numeric
      ? value.padStart(parameter.sourceLength, " ")
      : value.padEnd(parameter.sourceLength, " ");

    for (let i = 0; i < parameter.sourceLength; i += 1) {
      cells[parameter.sourceStart - 1 + i] = padded.charAt(i);
    }
  }

  const line = cells.join("").replace(/\s+$/u, "");

  // 1. 何も変えずに確定 → 元の行のまま
  const readBack = extractByColumns(line, definition);
  const unchanged = buildRpgLineText(line, definition, readBack);
  if (unchanged !== line) {
    fail(label, `無変更の確定で行が変わる\n      元: ${JSON.stringify(line)}\n      後: ${JSON.stringify(unchanged)}`);
    return;
  }

  // 2. 読み直した値が、書いた値と一致する
  for (const parameter of positional) {
    const expected = values[parameter.name].trim();
    const actual = String(readBack[parameter.name] ?? "").trim();
    if (expected !== actual) {
      fail(label, `${parameter.name}（${parameter.sourceStart} 桁目）の値が変わる（${JSON.stringify(expected)} → ${JSON.stringify(actual)}）`);
    }
  }
}

// ------------------------------------------------------------------------ 実行

const PROMPTER = join(root, "resources/prompter");
let checked = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!entry.endsWith(".json")) continue;

    const key = entry.slice(0, -5);
    const label = path.slice(PROMPTER.length + 1);
    const definition = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(definition.parameters) || definition.parameters.length === 0) continue;

    checked += 1;
    if (path.includes(`${"/"}rpg${"/"}`) || path.includes(`${"/"}dds${"/"}`)) {
      checkColumnStyle(label, key, definition);
    } else {
      checkKeywordStyle(label, definition);
    }
  }
}

walk(PROMPTER);

console.log(`プロンプター往復検証: ${checked} 定義`);

if (failures.length > 0) {
  console.error(`\n✗ 往復に失敗 ${failures.length} 件`);
  for (const failure of failures.slice(0, 20)) console.error(`  - ${failure}`);
  if (failures.length > 20) console.error(`  … 他 ${failures.length - 20} 件`);
  process.exit(1);
}

console.log("✓ 全定義で往復 OK（無変更の確定で桁が崩れず、入れた値が失われない）");
