// プロンプターの書き戻し（writeContinuedName ＋ buildRpgLineText）で、長い名前の継続名前行と字下げつきのサブフィールドを組む。
import { readFileSync, writeFileSync } from "node:fs";
import { buildRpgLineText } from "../../../../vscode-extension/out/prompter/commandText.js";
import { writeContinuedName } from "../../../../vscode-extension/out/prompter/rpgNameContinuation.js";
const here = new URL(".", import.meta.url).pathname;
const d = JSON.parse(readFileSync(new URL("../../../../vscode-extension/resources/prompter/rpg/ile/ja/D-SPEC.json", import.meta.url), "utf8"));
const long = writeContinuedName(["     D"], 0, "customerAccountBalance", (o, n) => buildRpgLineText(o, d, { NAME: n, DECLTYPE: "S", LEN: "11", INTTYPE: "P", DEC: "2" })).text;
const ds = buildRpgLineText("     D", d, { NAME: "REC", DECLTYPE: "DS" });
const sub = buildRpgLineText("     D  SUB1                   1      5", d, { NAME: "SUB9", FROM: "1", LEN: "5" });
const lines = [long, ds, sub, "     C                   EVAL      customerAccountBalance = 1", "     C                   SETON                                        LR", ""];
writeFileSync(here + "LONGNM.rpgle", lines.join("\n")); console.log(lines.join("\n"));
