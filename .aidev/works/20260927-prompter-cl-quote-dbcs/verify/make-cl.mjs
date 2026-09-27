// プロンプターの書き戻し（buildClCommandText）で、空白・日本語・アポストロフィを含む MSG の SNDPGMMSG を組み、CLLE にする。
import { readFileSync, writeFileSync } from "node:fs";
import { buildClCommandText } from "../../../../vscode-extension/out/prompter/commandText.js";
const here = new URL(".", import.meta.url).pathname;
const def = JSON.parse(readFileSync(new URL("../../../../vscode-extension/resources/prompter/cl/ja/SNDPGMMSG.json", import.meta.url), "utf8"));
const lines = [
  "             PGM",
  buildClCommandText(def, { MSG: "CMPLXPR で印刷エラーが発生しました", MSGTYPE: "*COMP" }),
  buildClCommandText(def, { MSG: "It's done" }),
  buildClCommandText(def, { MSG: "印刷装置でエラーが発生したので停止", MSGTYPE: "*COMP" }),
  "             ENDPGM",
  ""
];
writeFileSync(here + "CLQUOTE.clle", lines.join("\n"));
console.log(lines.join("\n"));
