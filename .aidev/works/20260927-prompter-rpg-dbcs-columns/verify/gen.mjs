import { readFileSync, writeFileSync } from "node:fs";
const { buildRpgLineText } = await import("/workspaces/as400-coding-helper/vscode-extension/out/prompter/commandText.js");
const c = JSON.parse(readFileSync("/workspaces/as400-coding-helper/vscode-extension/resources/prompter/rpg/ile/ja/C-SPEC.json", "utf8"));
const good = buildRpgLineText("     C", c, { OPCODE: "MOVEL", FACTOR2: "'無効'", RESULT: "MSG" });
const cat = buildRpgLineText("     C", c, { FACTOR1: "'顧客'", OPCODE: "CAT", FACTOR2: "'名前':1", RESULT: "TEXT" });
// 対照: 文字の添字で書いた行（直す前の書き方）。MSG は文字の 50 桁目＝実機では 54 桁目。
const old = ("     C" + " ".repeat(19) + "MOVEL".padEnd(10) + "'無効'".padEnd(14) + "MSG").trimEnd();
const head = ["     D MSG             S             20", "     D TEXT            S             20"];
const tail = ["     C                   SETON                                        LR"];
writeFileSync("/workspaces/as400-coding-helper/.aidev/works/20260927-prompter-rpg-dbcs-columns/verify/DBCSCOL.rpgle", [...head, good, cat, ...tail, ""].join("\n"));
writeFileSync("/workspaces/as400-coding-helper/.aidev/works/20260927-prompter-rpg-dbcs-columns/verify/DBCSOLD.rpgle", [...head, old, ...tail, ""].join("\n"));
console.log(good); console.log(cat); console.log(old);
