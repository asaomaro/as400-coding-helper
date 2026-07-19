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

console.log("DDS プロンプター定義の検査");

if (failures.length > 0) {
  console.error(`\n✗ DDS プロンプター定義 NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\n✓ DDS プロンプター定義 OK（桁はルーラーの桁定義と一致）");
