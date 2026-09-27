// プロンプターの書き戻し（buildRpgLineText）で、定義を直した欄を使う行を組み、RPGLE にする。
import { readFileSync, writeFileSync } from "node:fs";
import { buildRpgLineText } from "../../../../vscode-extension/out/prompter/commandText.js";
const here = new URL(".", import.meta.url).pathname;
const def = name => JSON.parse(readFileSync(new URL(`../../../../vscode-extension/resources/prompter/rpg/ile/ja/${name}.json`, import.meta.url), "utf8"));
const [H, F, D, C, CN, P] = ["H-SPEC", "F-SPEC", "D-SPEC", "C-SPEC", "C-NEW", "P-SPEC"].map(def);
const w = (d, prefix, values) => buildRpgLineText(prefix, d, values);
const lines = [
  "     H DFTACTGRP(*NO)",
  w(F, "     F", { FILENAME: "QSYSPRT", FILETYPE: "O", FILEDESG: "", FILEFMT: "F", RECLEN: "132", DEVICE: "PRINTER" }),
  w(D, "     D", { NAME: "IND01", DECLTYPE: "S", LEN: "1", INTTYPE: "N" }),
  w(D, "     D", { NAME: "AMT", DECLTYPE: "S", LEN: "7", INTTYPE: "P", DEC: "2" }),
  w(D, "     D", { NAME: "CNT", DECLTYPE: "S", LEN: "5", INTTYPE: "U", DEC: "0" }),
  w(D, "     D", { NAME: "Addone", DECLTYPE: "PR" }),
  w(CN, "     C", { OPCODE: "IF", COND: "IND01" }),
  w(CN, "     C", { OPCODE: "EVAL", COND: "AMT = 1.25" }),
  w(CN, "     C", { OPCODE: "ELSE" }),
  w(CN, "     C", { OPCODE: "CALLP", COND: "Addone()" }),
  w(CN, "     C", { OPCODE: "ENDIF" }),
  w(C, "     C", { OPCODE: "SETON", RESIND_HI: "LR" }),
  w(P, "     P", { PROCNAME: "Addone", BEGINEND: "B" }),
  w(CN, "     C", { OPCODE: "EVAL", COND: "CNT = CNT + 1" }),
  w(P, "     P", { BEGINEND: "E" }),
  ""
];
writeFileSync(here + "GAPS.rpgle", lines.join("\n"));
console.log(lines.join("\n"));
