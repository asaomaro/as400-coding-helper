// プロンプターの書き戻し（buildRpgLineText）で DSPF と RPG の行を組み、実機でコンパイルする見本を書く。
// P4DECL/P4DECR/P4POSL.dspf は左詰め／右寄せの対照（手で組んだもの。左詰めは CPD7422 で作成できない）。
import { readFileSync, writeFileSync } from "node:fs";
import { buildRpgLineText } from "../../../../vscode-extension/out/prompter/commandText.js";
const here = new URL(".", import.meta.url).pathname;
const def = rel => JSON.parse(readFileSync(new URL(`../../../../vscode-extension/resources/prompter/${rel}`, import.meta.url), "utf8"));
const dspf = def("dds/ja/DDS-DSPF.json"), c = def("rpg/ile/ja/C-SPEC.json"), d = def("rpg/ile/ja/D-SPEC.json");
const w = (definition, prefix, values) => buildRpgLineText(prefix, definition, values);
writeFileSync(here + "P4D.dspf", [
  "     A                                      DSPSIZ(24 80 *DS3) CA03(03)",
  "     A          R REC",
  w(dspf, "     A", { C6: "A", C8: "40", C19: "AMT", C30: "7", C35: "Y", C36: "0", C38: "B", C39: "7 74" }),
  w(dspf, "     A", { C6: "A", C19: "NAME", C30: "10", C38: "B", C39: "8 2" }),
  ""
].join("\n"));
writeFileSync(here + "P4R.rpgle", [
  "     FP4D       CF   E             WORKSTN",
  "     D DS1             DS",
  w(d, "     D", { NAME: "F1", FROM: "1", LEN: "5" }),
  w(d, "     D", { NAME: "F2", FROM: "6", LEN: "12" }),
  w(c, "     C", { INDICATORS: "N03", OPCODE: "Z-ADD", FACTOR2: "0", RESULT: "AMT", RESIND_EQ: "50" }),
  w(c, "     C", { INDICATORS: "50", OPCODE: "SETON", RESIND_HI: "40" }),
  w(c, "     C", { OPCODE: "EXFMT", FACTOR2: "REC" }),
  w(c, "     C", { OPCODE: "SETON", RESIND_HI: "LR" }),
  ""
].join("\n"));
console.log(readFileSync(here + "P4D.dspf", "utf8") + readFileSync(here + "P4R.rpgle", "utf8"));
