#!/usr/bin/env node
"use strict";

// ビルド成果物への薄いランチャ。out/ が無い状態で叩かれたときに
// MODULE_NOT_FOUND の生スタックではなく、何をすべきかを返す。
const fs = require("node:fs");
const path = require("node:path");

const entry = path.join(__dirname, "..", "out", "src", "main.js");

if (!fs.existsSync(entry)) {
  process.stderr.write(
    "dds: ビルドされていません。`npm run build -w @as400/dds-cli` を実行してください。\n"
  );
  process.exit(1);
}

const { main } = require(entry);
process.exitCode = main(process.argv.slice(2));
