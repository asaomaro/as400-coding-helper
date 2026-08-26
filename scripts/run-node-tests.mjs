#!/usr/bin/env node
// 指定ディレクトリ配下の *.test.js を再帰的に集めて `node --test` に明示的に渡す。
//
// なぜランナーを挟むか（実測に基づく）:
//   - `node --test <dir>` は Node v24.15.0 でディレクトリをモジュール解決しようとして落ちる。
//   - `node --test "<glob>"` の展開は Node 側の機能で、**Node 20 では動かない**
//     （`Could not find '.../out/test/**/*.test.js'`）。CI は Node 20 を使う。
//   - シェル側の glob（引用なし）は動くが `*.test.js` が平坦な階層しか拾えず、
//     サブディレクトリのテストを**無言で取りこぼす**。テストが存在するのに走らない状態は
//     このリポジトリで実際に起きていた（research F12）ので、最も避けたい失敗様式。
//
// したがってファイル列挙を自前で行い、0 件なら失敗させる（緑の空振りを作らない）。
//
// 使い方: node scripts/run-node-tests.mjs [testDir=out/test]

import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.argv[2] ?? "out/test";

if (!existsSync(root)) {
  console.error(
    `run-node-tests: テストディレクトリがありません: ${root}\n` +
      "先にビルドしてください（npm run build）。"
  );
  process.exit(1);
}

/** @param {string} dir @returns {string[]} */
function collect(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collect(full));
    } else if (entry.endsWith(".test.js")) {
      found.push(full);
    }
  }
  return found;
}

const files = collect(root).sort();

if (files.length === 0) {
  console.error(
    `run-node-tests: ${root} 配下にテストファイル(*.test.js)が 1 件もありません。\n` +
      "テストが走っていないのに緑になる状態を避けるため、失敗として扱います。"
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit"
});

process.exit(result.status ?? 1);
