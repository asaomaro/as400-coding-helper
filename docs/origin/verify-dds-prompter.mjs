#!/usr/bin/env node
/**
 * DDS のプロンプター定義を検査する。
 *
 * 生成は docs/origin/generate-dds-prompter.mjs。
 * 桁の正は navigation の桁定義（原典から generate-dds-columns.mjs が作る）で、
 * プロンプターの桁がそれと食い違っていないかを見る。ルーラーとプロンプターで
 * 違う桁を出すと、どちらを信じてよいか分からなくなる。
 *
 * 使い方:  node docs/origin/verify-dds-prompter.mjs
 * 終了コード: 0=OK / 1=不一致
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const NAV = join(ROOT, "vscode-extension/resources/navigation");
const PROMPTER = join(ROOT, "vscode-extension/resources/prompter/dds");

const columns = JSON.parse(readFileSync(join(NAV, "dds-keyword-columns.json"), "utf8"));
const SOURCE_WIDTH = 80;
const failures = [];

for (const lang of ["ja", "en"]) {
  for (const type of ["DDS-PF", "DDS-DSPF", "DDS-PRTF"]) {
    const file = join(PROMPTER, lang, `${type}.json`);
    if (!existsSync(file)) {
      failures.push(`${lang}/${type}: 定義が無い`);
      continue;
    }

    const definition = JSON.parse(readFileSync(file, "utf8"));
    const parameters = definition.parameters ?? [];
    const starts = columns[type];

    if (parameters.length !== starts.length) {
      failures.push(`${lang}/${type}: 欄の数が桁定義と違う（${parameters.length} / ${starts.length}）`);
      continue;
    }

    let expectedStart = 1;
    parameters.forEach((parameter, index) => {
      if (parameter.sourceStart !== starts[index]) {
        failures.push(
          `${lang}/${type}.${parameter.name}: 開始桁が桁定義と違う（${parameter.sourceStart} / ${starts[index]}）`
        );
      }
      // 欄が途切れず 1-80 桁を覆っていること。隙間があるとその桁は編集できない。
      if (parameter.sourceStart !== expectedStart) {
        failures.push(`${lang}/${type}.${parameter.name}: ${expectedStart} 桁目からの欄が無い`);
      }
      expectedStart = parameter.sourceStart + parameter.sourceLength;

      for (const option of parameter.options ?? []) {
        if (option.value !== "" && !/^[A-Z0-9]$/u.test(option.value)) {
          failures.push(`${lang}/${type}.${parameter.name}: 値が1文字でない（${option.value}）`);
        }
      }
    });

    if (expectedStart !== SOURCE_WIDTH + 1) {
      failures.push(`${lang}/${type}: 80 桁目まで覆っていない（${expectedStart - 1} 桁で終わり）`);
    }

    // 長さの欄は原典が「右寄せで指定しなければならない」と書いている。
    // 左詰めで書き戻すと実機の CRTPF が通らない（CPF7311）。
    const length = parameters.find(p => p.sourceStart === 30);
    if (length && !length.attributes?.numericOnly) {
      failures.push(`${lang}/${type}: 長さの欄(30 桁目)が右寄せになっていない`);
    }

    console.log(
      `  ${lang}/${type}: ${parameters.length} 欄（選択欄 ${parameters.filter(p => p.options).length} / 右寄せ ${parameters.filter(p => p.attributes?.numericOnly).length}）`
    );
  }
}

/**
 * **ja と en で値集合・`restricted` が一致すること。**
 *
 * 英語版で変えてよいのは**表示に出る文字だけ**で、構造（値・入力種別・制限の有無）は
 * 同じでなければならない。ずれると**同じソースが言語で違う結果になる**——
 * `restricted: true` の欄では lint の指摘が言語で変わり、プロンプターでは
 * 書き戻せる値が変わる。
 *
 * ずれ得る理由がある。値の一部は**原典の「注」から拾っており**、注は
 * 200 文字の窓で切っている（`generate-dds-prompter.mjs` の `addNoteDataTypes`）。
 * 窓の内側に入る語は**日英で違う**ので、片方だけが値を拾うことが起こりうる
 * （現に物理/論理は ja の窓に `A (文字)` が入り en には入らない。
 * どちらも既存の値なので、いまは結果に出ていないだけ）。
 *
 * ラベルは訳文なので比べない。
 */
for (const type of ["DDS-PF", "DDS-DSPF", "DDS-PRTF"]) {
  const read = lang => {
    const file = join(PROMPTER, lang, `${type}.json`);
    if (!existsSync(file)) return new Map();
    const definition = JSON.parse(readFileSync(file, "utf8"));
    return new Map(
      (definition.parameters ?? []).map(p => [
        p.sourceStart,
        {
          values: (p.options ?? []).map(o => o.value).join("|"),
          inputType: p.inputType ?? "",
          restricted: p.attributes?.restricted
        }
      ])
    );
  };
  const ja = read("ja");
  const en = read("en");

  for (const [start, a] of ja) {
    const b = en.get(start);
    if (!b) {
      failures.push(`${type}: ${start} 桁目の欄が en に無い`);
      continue;
    }
    if (a.values !== b.values) {
      failures.push(`${type}: ${start} 桁目の値が ja/en で違う（ja=${a.values || "なし"} / en=${b.values || "なし"}）`);
    }
    if (a.inputType !== b.inputType) {
      failures.push(`${type}: ${start} 桁目の入力種別が ja/en で違う（ja=${a.inputType} / en=${b.inputType}）`);
    }
    if (a.restricted !== b.restricted) {
      failures.push(`${type}: ${start} 桁目の restricted が ja/en で違う（ja=${a.restricted} / en=${b.restricted}）`);
    }
  }
  for (const start of en.keys()) {
    if (!ja.has(start)) failures.push(`${type}: ${start} 桁目の欄が ja に無い`);
  }
}

console.log("DDS プロンプター定義の検査");

if (failures.length > 0) {
  console.error(`\n✗ DDS プロンプター定義 NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\n✓ DDS プロンプター定義 OK（桁はルーラーの桁定義と一致）");
