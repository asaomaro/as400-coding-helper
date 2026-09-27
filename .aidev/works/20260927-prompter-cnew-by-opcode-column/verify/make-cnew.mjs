// C-NEW の行をプロンプターの書き戻し（buildRpgLineText）で組み、行の分類（classifyRpgSpecKeyword）も確かめて実機に掛ける見本を書く。
import { readFileSync, writeFileSync } from "node:fs";
import { buildRpgLineText } from "../../../../vscode-extension/out/prompter/commandText.js";
import { classifyRpgSpecKeyword } from "../../../../vscode-extension/out/core/rpgSpec.js";
const here = new URL(".", import.meta.url).pathname;
const cNew = JSON.parse(readFileSync(new URL("../../../../vscode-extension/resources/prompter/rpg/ile/ja/C-NEW.json", import.meta.url), "utf8"));
const lines = [
  "     D X               S              5P 2",
  "     C                   SETON                                        50",
  buildRpgLineText("     C", cNew, { INDICATORS: "50", OPCODE: "EVAL(H)", COND: "X = 10 / 3" }),
  buildRpgLineText("     C", cNew, { INDICATORS: "N50", OPCODE: "EVAL", COND: "X = 0" }),
  "     C                   SETON                                        LR",
  ""
];
writeFileSync(here + "CNEWR.rpgle", lines.join("\n"));
for (const line of lines.filter(Boolean)) console.log(`${classifyRpgSpecKeyword(line, { dialect: "ile" }).padEnd(7)}|${line}`);
