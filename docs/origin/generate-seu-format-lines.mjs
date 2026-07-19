#!/usr/bin/env node
/**
 * 実機の SEU 書式行(FMT)を拡張機能のリソースに落とす。
 *
 * 出所は docs/origin/rpg3-seu-format-lines.json（pub400 の SEU から実測したもの）。
 * RPG III の桁は第三者資料しか無いため、実機の書式行を桁の正としている。
 *
 * ルーラーはこの書式行をそのまま 1 行で出す。合成せず実測値を使うのは、
 * SEU の書式行が「どの欄がどこから始まるか」を実機が示したものだからで、
 * 桁の並びも欄名の綴りもこれ以上正しいものが無い。
 *
 * 使い方:  node docs/origin/generate-seu-format-lines.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const OUT = join(ROOT, "vscode-extension/resources/navigation");

const origin = JSON.parse(readFileSync(join(HERE, "rpg3-seu-format-lines.json"), "utf8"));
const dds = JSON.parse(readFileSync(join(HERE, "dds-seu-format-lines.json"), "utf8"));

/**
 * 書式行のキーはルーラー側の仕様書キーに合わせる。
 * O 仕様書だけは実機も「レコード行」と「フィールド行」で書式行が違うため 2 本ある。
 */
const KEYS = {
  H: "H-SPEC",
  F: "F-SPEC",
  E: "E-SPEC",
  L: "L-SPEC",
  I: "I-SPEC",
  C: "C-SPEC",
  "O-record": "O-SPEC-RECORD",
  "O-field": "O-SPEC-FIELD"
};

const templates = {};
for (const [origKey, template] of Object.entries(origin.templates)) {
  const key = KEYS[origKey];
  if (!key) {
    throw new Error(`未知の書式行キー: ${origKey}`);
  }
  // 末尾の余白は表示側で幅を決めるため落とす。
  templates[key] = template.replace(/\s+$/u, "");
}

// DDS の書式行は実機のメッセージ・ファイル QEDTMSG から取得したもの。
// SEU が実際に出している文字列そのものなので、欄名を合成せずこれをそのまま出す。
// ルーラーが日本語の欄名を出していたのを、実機と同じ表記に合わせるため。
for (const [key, id] of Object.entries(dds.mapping)) {
  const template = dds.templates[id];
  if (!template) {
    throw new Error(`DDS の書式行が見つからない: ${key} (${id})`);
  }
  templates[key] = template.line.replace(/\s+$/u, "");
}

const result = {
  note:
    `SEU の書式行。RPG III は実機 ${origin.source.host} の SEU から実測、` +
    `DDS は実機のメッセージ・ファイル QEDTMSG から取得したもの。`,
  method: origin.source.method,
  ddsMethod: dds.method,
  templates
};

mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, "rpg3-seu-format-lines.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8"
);

console.log(`SEU 書式行: ${Object.keys(templates).length} 件`);
for (const [key, template] of Object.entries(templates)) {
  console.log(`  ${key.padEnd(14)} ${template.length} 桁`);
}
console.log("出力: resources/navigation/rpg3-seu-format-lines.json");
