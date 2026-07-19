#!/usr/bin/env node
/**
 * ILE RPG 仕様書プロンプター定義の英語版を作る。
 *
 * 構造（入力欄の名前・桁・選択肢の値・入力種別）は日本語版が正で、
 * 表示に出る文字だけを rpg-spec-en-strings.json の訳文に差し替える。
 * 構造まで作り直すと、同じソースなのに言語で書き戻し結果が変わる。
 *
 * 訳文を別ファイルに集約しているのは、英語原典の文が欄の説明として使えない
 * ため。原典は自由形式の構文説明（「Free-Form Syntax ...」）が混ざる長い散文で、
 * 入力欄の脇に出す短い説明にはならない。日本語版の簡潔な説明を訳す方が実用的で、
 * 訳文が1か所に集まっていれば見直しもできる。
 *
 * 桁・欄の名前・選択肢の値といった「事実」は訳文ファイルに入れない。
 * それらは日本語版（＝原典と検査で突き合わせ済み）から引き継ぐ。
 *
 * RPG III(rpg3) は対象外。IBM の RPG/400 Reference が入手できず、日本語版しか
 * 無いため英語版を作らない（読み込み側が日本語版に落ちる）。
 *
 * 使い方:  node docs/origin/generate-rpg-spec-definitions.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const ORIGIN = join(HERE, "ilerpg-en");
const SRC = join(ROOT, "vscode-extension/resources/prompter/rpg/ile/ja");
const OUT = join(ROOT, "vscode-extension/resources/prompter/rpg/ile/en");

const STRINGS = JSON.parse(readFileSync(join(HERE, "rpg-spec-en-strings.json"), "utf8"));

mkdirSync(OUT, { recursive: true });

let translated = 0;
let total = 0;
const missing = [];

for (const file of readdirSync(SRC).filter(name => name.endsWith(".json"))) {
  const key = file.slice(0, -5);
  const definition = JSON.parse(readFileSync(join(SRC, file), "utf8"));
  const strings = STRINGS[key];

  if (!strings) {
    missing.push(key);
    continue;
  }

  definition.description = strings.description ?? definition.description;
  definition.help = strings.help ?? undefined;

  definition.parameters = definition.parameters.map(parameter => {
    total += 1;
    const text = strings[parameter.name];
    if (!text) {
      missing.push(`${key}.${parameter.name}`);
      // 訳が無いものに日本語を残すと英語版に日本語が混ざる。欄の名前を出す。
      return { ...parameter, description: parameter.name, help: undefined };
    }

    translated += 1;
    return {
      ...parameter,
      description: text.description ?? parameter.name,
      help: text.help,
      ...(parameter.options
        ? {
            // 値は言語に依らないのでそのまま。ラベルだけ訳す。
            options: parameter.options.map(option => ({
              label: text.options?.[option.value] ?? option.value,
              value: option.value
            }))
          }
        : {})
    };
  });

  definition.source = "Translated from the Japanese definition (docs/origin/rpg-spec-en-strings.json)";
  writeFileSync(join(OUT, file), `${JSON.stringify(definition, null, 2)}\n`, "utf8");
}

console.log(`英語版の定義: ${readdirSync(OUT).length} 件`);
console.log(`訳を当てた欄: ${translated} / ${total}`);
if (missing.length > 0) {
  console.log(`訳が無く欄の名前をそのまま出すもの: ${missing.length} 件`);
  for (const name of missing) console.log(`  - ${name}`);
}
console.log(`\n出力: resources/prompter/rpg/ile/en/`);
