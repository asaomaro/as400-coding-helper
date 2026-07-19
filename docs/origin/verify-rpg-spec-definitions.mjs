#!/usr/bin/env node
/**
 * RPG 仕様書プロンプター定義の英語版を検査する。
 *
 * 生成は docs/origin/generate-rpg-spec-definitions.mjs。
 * 英語版で変えてよいのは表示に出る文字だけで、構造（入力欄の名前・桁・
 * 選択肢の値・入力種別）は日本語版と同じでなければならない。ここがずれると、
 * 同じソースなのに言語で書き戻し結果が変わる。
 *
 * 使い方:  node docs/origin/verify-rpg-spec-definitions.mjs
 * 終了コード: 0=OK / 1=不一致
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const BASE = join(ROOT, "vscode-extension/resources/prompter/rpg");

const failures = [];
const structure = parameter => ({
  name: parameter.name,
  inputType: parameter.inputType,
  sourceStart: parameter.sourceStart,
  sourceLength: parameter.sourceLength,
  required: parameter.required,
  values: (parameter.options ?? []).map(option => option.value)
});

for (const dialect of readdirSync(BASE)) {
  const ja = join(BASE, dialect, "ja");
  const en = join(BASE, dialect, "en");

  if (!existsSync(ja)) {
    failures.push(`${dialect}: 日本語版が無い`);
    continue;
  }

  // 英語原典が無い方言（RPG III）は英語版を持たない。読み込み側が日本語版に
  // 落ちるので、無いこと自体は不具合ではない。
  if (!existsSync(en)) {
    console.log(`  ${dialect}: 英語版なし（日本語版に落ちる）`);
    continue;
  }

  let checked = 0;
  let japanese = 0;

  for (const file of readdirSync(en).filter(name => name.endsWith(".json"))) {
    const jaPath = join(ja, file);
    if (!existsSync(jaPath)) {
      failures.push(`${dialect}/${file}: 日本語版に対応が無い`);
      continue;
    }

    const jaDef = JSON.parse(readFileSync(jaPath, "utf8"));
    const enDef = JSON.parse(readFileSync(join(en, file), "utf8"));

    const jaStructure = JSON.stringify(jaDef.parameters.map(structure));
    const enStructure = JSON.stringify(enDef.parameters.map(structure));
    if (jaStructure !== enStructure) {
      failures.push(`${dialect}/${file}: 構造が日本語版と違う`);
      continue;
    }

    // 英語版に日本語が残っていたら、原典から取れずに素通しした証拠。
    const text = JSON.stringify([
      enDef.description,
      enDef.help,
      ...enDef.parameters.flatMap(p => [p.description, p.help, ...(p.options ?? []).map(o => o.label)])
    ]);
    if (/[ぁ-んァ-ヶ一-龠]/u.test(text)) {
      japanese += 1;
      failures.push(`${dialect}/${file}: 英語版に日本語が残っている`);
    }

    checked += 1;
  }

  console.log(`  ${dialect}: ${checked} 件（構造一致 / 日本語混入 ${japanese} 件）`);
}

console.log("RPG 仕様書定義（英語版）の検査");

if (failures.length > 0) {
  console.error(`\n✗ RPG 仕様書定義 NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\n✓ RPG 仕様書定義 OK（構造は日本語版と一致、英語版に日本語なし）");
