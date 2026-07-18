#!/usr/bin/env node
/**
 * DDS のルーラー桁定義が原典と一致しているかを検査する。
 *
 * 生成は docs/origin/generate-dds-columns.mjs。この検査は
 * 「生成し直しても同じ結果になるか」と「桁の一覧として壊れていないか」を見る。
 *
 * DDS は原典のページごとに書き方が揺れる（区切りが「から」「-」「−」、
 * 条件付けを表示装置/印刷装置は注記桁を含めて「7-16」と書く、表示装置は
 * 先頭3欄をまとめて「1-7」とだけ書く、など）。生成側でそれらを正規化して
 * いるため、ここでは正規化後の不変条件を確かめる。
 *
 * 使い方:  node docs/origin/verify-dds-columns.mjs
 * 終了コード: 0=OK / 1=不一致
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const NAV = join(ROOT, "vscode-extension/resources/navigation");

const columns = JSON.parse(readFileSync(join(NAV, "dds-keyword-columns.json"), "utf8"));
const labels = JSON.parse(readFileSync(join(NAV, "dds-field-labels.json"), "utf8"));

const failures = [];
const TYPES = ["DDS-PF", "DDS-DSPF", "DDS-PRTF"];

for (const type of TYPES) {
  const cols = columns[type];
  const names = labels[type];

  if (!Array.isArray(cols) || cols.length === 0) {
    failures.push(`${type}: 桁定義が無い`);
    continue;
  }
  if (!Array.isArray(names) || names.length !== cols.length) {
    failures.push(`${type}: 桁 ${cols.length} 件に対しラベル ${names?.length ?? 0} 件`);
    continue;
  }

  // ルーラーは開始桁の一覧。重複があると欄が消え、昇順でないと表示が崩れる。
  if (new Set(cols).size !== cols.length) {
    failures.push(`${type}: 桁が重複している（${cols.join(" ")}）`);
  }
  if (cols.some((value, i) => i > 0 && value <= cols[i - 1])) {
    failures.push(`${type}: 桁が昇順でない（${cols.join(" ")}）`);
  }
  // JSON は 1 始まりの桁で保存する（keywordColumns.ts が読み込み時に 0 始まりへ
  // 変換する）。既存の rpg-fixed-keyword-columns.json と同じ規約。
  if (cols[0] !== 1) {
    failures.push(`${type}: 先頭が 1 桁目でない（${cols[0]} 桁目）`);
  }
  if (cols.some(value => value < 1 || value > 80)) {
    failures.push(`${type}: 範囲外の桁がある（${cols.join(" ")}）`);
  }

  // DDS は種別によらず、6 桁目が仕様書タイプ・45 桁目からキーワード項目。
  // ここがずれると他の欄も総崩れになるため、要となる2点だけ明示的に見る。
  if (!cols.includes(6)) {
    failures.push(`${type}: 6 桁目（仕様書タイプ）が無い`);
  }
  if (!cols.includes(45)) {
    failures.push(`${type}: 45 桁目（キーワード項目）が無い`);
  }
  if (names.some(name => !name || name.trim().length === 0)) {
    failures.push(`${type}: 空のラベルがある`);
  }
}

console.log(`DDS 桁定義の検査: ${TYPES.length} 種別`);
for (const type of TYPES) {
  const cols = columns[type] ?? [];
  console.log(`  ${type.padEnd(9)} ${cols.length} 欄  ${cols.join(" ")}`);
}

if (failures.length > 0) {
  console.error(`\n✗ DDS 桁定義 NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\n✓ DDS 桁定義 OK");
