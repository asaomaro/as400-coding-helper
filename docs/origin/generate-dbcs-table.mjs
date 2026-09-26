#!/usr/bin/env node
/**
 * 「実機で DBCS（2 バイト）になる文字」の表を、変換表から生成する。
 *
 * 生成物は `vscode-extension/src/core/dbcsTable.ts`。`isDbcsCodePoint` がこれを引く。
 *
 * ■ 手書きの範囲では足りなかった
 *   以前は「ひらがな・カタカナ・CJK・全角英数」を手で並べていたが、罫線（`─` U+2500）・
 *   記号（`■` `※` `→`）・ギリシャ文字・`「」、。`（U+3000 台）が漏れていた。
 *   これらは実機では DBCS で、SO/SI と 2 桁を取る。実際、罫線だけの定数を 80 桁で
 *   折ったつもりが実機では 116 桁になり、ソース・メンバーに入り切らずに半分消えた。
 *
 * ■ 原典は CCSID 5035（= IBM-939 の混在）
 *   本 PJ の実機検証が使うソース物理ファイルは CCSID 5035。glibc の iconv が
 *   同じ変換表（`IBM939`）を持っているので、全 BMP の文字を 1 文字ずつ通して、
 *   **SO（0x0E）で始まる形になったもの**を DBCS とする。
 *   変換できない文字（CJK 拡張 B など）はこの表の外で、従来の範囲判定に任せる。
 *
 * 使い方:  node docs/origin/generate-dbcs-table.mjs          # 生成
 *          node docs/origin/generate-dbcs-table.mjs --check  # 生成物と一致するか
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../vscode-extension/src/core/dbcsTable.ts");

// 1 文字ずつ改行で区切って 1 回で通す。変換できない文字は -c で落ちて空行になるので、
// 改行（EBCDIC 0x25）で切れば元の並びと対応する。DBCS のバイトは 0x40 以上で 0x25 と衝突しない。
const codePoints = [];
for (let cp = 0x20; cp <= 0xffff; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  codePoints.push(cp);
}
const input = codePoints.map((cp) => String.fromCodePoint(cp)).join("\n");
const bytes = execFileSync("iconv", ["-c", "-f", "UTF-8", "-t", "IBM939"], {
  input: Buffer.from(input, "utf8"),
  maxBuffer: 16 * 1024 * 1024
});
const lines = [];
let start = 0;
for (let i = 0; i <= bytes.length; i++) {
  if (i === bytes.length || bytes[i] === 0x25) {
    lines.push(bytes.subarray(start, i));
    start = i + 1;
  }
}
if (lines.length !== codePoints.length) {
  throw new Error(`区切りが合わない: ${lines.length} 行 / ${codePoints.length} 文字`);
}

const ranges = [];
for (let i = 0; i < codePoints.length; i++) {
  if (lines[i][0] !== 0x0e) continue;
  const cp = codePoints[i];
  const last = ranges[ranges.length - 1];
  if (last && last[1] === cp - 1) last[1] = cp;
  else ranges.push([cp, cp]);
}

const hex = (n) => `0x${n.toString(16).padStart(4, "0")}`;
const body = ranges.map(([a, b]) => `  ${hex(a)}, ${hex(b)},`).join("\n");
const text = `// このファイルは docs/origin/generate-dbcs-table.mjs が生成する。手で直さない。
//
// CCSID 5035（IBM-939）で DBCS（SO/SI で囲まれる 2 バイト）になる BMP の文字の範囲。
// [開始, 終了] の組を昇順に並べた平たい配列（${ranges.length} 組）。

export const DBCS_RANGES_IBM939: readonly number[] = [
${body}
];
`;

if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf8");
  if (current !== text) {
    console.error("dbcsTable.ts が変換表と一致しない。generate-dbcs-table.mjs を流し直すこと。");
    process.exit(1);
  }
  console.log(`一致（${ranges.length} 範囲）`);
} else {
  writeFileSync(OUT, text);
  console.log(`${OUT} に ${ranges.length} 範囲を書いた`);
}
