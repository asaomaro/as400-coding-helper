#!/usr/bin/env node
/**
 * RPG III(RPG/400) の命令コード補完データを検査する。
 *
 * 原典は実機のコンパイラの判定結果（rpg3-opcodes-on-ibmi.json）。実機は CI から
 * 触れないので、ここでは「生成物が実機の判定と一致しているか」だけを見る。
 * 実機での再判定は docs/origin/probe-rpg3-opcodes.sh。
 *
 * 使い方:  node docs/origin/verify-rpg3-completion.mjs
 * 終了コード: 0=OK / 1=不一致
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const COMPLETION = join(ROOT, "vscode-extension/resources/completion");

const snapshot = JSON.parse(readFileSync(join(HERE, "rpg3-opcodes-on-ibmi.json"), "utf8"));
const failures = [];

/** RPG III の命令コード欄は 28-32 桁。5 文字を超える名前はそもそも書けない。 */
const MAX_LENGTH = 5;

for (const lang of ["ja", "en"]) {
  const file = join(COMPLETION, lang === "ja" ? "rpg3-completion.json" : `rpg3-completion.${lang}.json`);
  if (!existsSync(file)) {
    failures.push(`${lang}: 補完データが無い（${file}）`);
    continue;
  }

  const data = JSON.parse(readFileSync(file, "utf8"));
  const names = (data.opcodes ?? []).map(o => o.name);

  // 実機が有効と判定したものと過不足なく一致すること。
  const missing = snapshot.valid.filter(n => !names.includes(n));
  const extra = names.filter(n => !snapshot.valid.includes(n));
  if (missing.length > 0) failures.push(`${lang}: 実機が有効とした命令が欠けている（${missing.join(", ")}）`);
  if (extra.length > 0) failures.push(`${lang}: 実機の判定に無い命令が入っている（${extra.join(", ")}）`);

  // 実機が棄却したもの（EVAL / CALLP など RPG IV の命令）が混ざっていないこと。
  const rejected = names.filter(n => snapshot.rejected.includes(n));
  if (rejected.length > 0) failures.push(`${lang}: 実機が棄却した命令が入っている（${rejected.join(", ")}）`);

  const tooLong = names.filter(n => n.length > MAX_LENGTH);
  if (tooLong.length > 0) failures.push(`${lang}: 命令コード欄(28-32)に収まらない（${tooLong.join(", ")}）`);

  if (new Set(names).size !== names.length) failures.push(`${lang}: 名前が重複している`);

  if (data.opcodeColumns?.from !== 28 || data.opcodeColumns?.to !== 32) {
    failures.push(`${lang}: 命令コード欄の桁が 28-32 でない`);
  }

  console.log(`  ${lang}: ${names.length} 件（説明あり ${(data.opcodes ?? []).filter(o => o.title).length} 件）`);
}

console.log("RPG III 命令コードの検査");

if (failures.length > 0) {
  console.error(`\n✗ RPG III 命令コード NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`\n✓ RPG III 命令コード OK（実機 ${snapshot.machine} の判定と一致）`);
console.log("※ 候補に無い命令は実機でも検出できない。集合を疑うときは probe-rpg3-opcodes.sh の候補を足して測り直す。");
