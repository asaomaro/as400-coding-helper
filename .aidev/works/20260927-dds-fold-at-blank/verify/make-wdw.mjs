// キーワード欄の折り返し（foldKeywordArea）で WDWTITLE を折ったウィンドウ様式の画面を書く。
import { writeFileSync } from "node:fs";
import { foldKeywordArea, buildKeywordLine, writeBackKeywordArea } from "../../../../vscode-extension/out/core/dds/ddsEditWriteBack.js";
const here = new URL(".", import.meta.url).pathname;
const chunks = foldKeywordArea("WINDOW(8 20 9 44) WDWTITLE((*TEXT '顧客詳細') (*COLOR WHT))");
const record = writeBackKeywordArea("     A          R WIN01", chunks[0]);
const lines = [
  "     A                                      DSPSIZ(24 80 *DS3) CA03(03)",
  record,
  ...chunks.slice(1).map(buildKeywordLine),
  "     A                                  2  2'CODE'",
  ""
];
writeFileSync(here + "WDWFOLD.dspf", lines.join("\n"));
console.log(lines.join("\n"));
