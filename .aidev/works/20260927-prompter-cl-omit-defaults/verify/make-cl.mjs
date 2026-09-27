// プロンプターの書き戻し（buildClCommandText）で既定値を省いた CL を組む。
import { readFileSync, writeFileSync } from "node:fs";
import { buildClCommandText } from "../../../../vscode-extension/out/prompter/commandText.js";
const here = new URL(".", import.meta.url).pathname;
const def = n => JSON.parse(readFileSync(new URL(`../../../../vscode-extension/resources/prompter/cl/ja/${n}.json`, import.meta.url), "utf8"));
const lines = [
  "             PGM",
  buildClCommandText(def("OVRPRTF"), { FILE: "CMPLXP", LENGTH: "66", WIDTH: "132", PAGESIZE_UOM: "*ROWCOL" }),
  buildClCommandText(def("CALL"), { LIB: "*LIBL", PGM: "CMPLXPR" }),
  "             ENDPGM", ""
];
writeFileSync(here + "CLDFT.clle", lines.join("\n")); console.log(lines.join("\n"));
