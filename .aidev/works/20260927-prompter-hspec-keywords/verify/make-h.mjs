// プロンプターの書き戻し（buildRpgLineText）で H 仕様書を組み（80 桁を超えて 2 行になる形）、RPGLE にする。
import { readFileSync, writeFileSync } from "node:fs";
import { buildRpgLineText } from "../../../../vscode-extension/out/prompter/commandText.js";
const here = new URL(".", import.meta.url).pathname;
const h = JSON.parse(readFileSync(new URL("../../../../vscode-extension/resources/prompter/rpg/ile/ja/H-SPEC.json", import.meta.url), "utf8"));
const lines = [
  buildRpgLineText("     H", h, { DFTACTGRP: "*NO", ACTGRP: "'HSPECTEST'", DATFMT: "*ISO", BNDDIR: "'QC2LE'", COPYRIGHT: "'(C) 2026 EXAMPLE CORPORATION'" }),
  "     D today           S               D   INZ(*SYS)",
  "     C                   SETON                                        LR",
  ""
];
writeFileSync(here + "HSPEC.rpgle", lines.join("\n"));
console.log(lines.join("\n"));
