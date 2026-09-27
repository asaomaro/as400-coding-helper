// エディタと同じ経路（applyDdsEdits の addFileKeywords）で、ファイル・レベルの行が 1 本も無い帳票に 1 つ目を足す。
import { writeFileSync } from "node:fs";
import { applyDdsEdits } from "../../../../vscode-extension/out/core/dds/ddsEdit.js";
const here = new URL(".", import.meta.url).pathname;
const lines = ["     A* 帳票", "     A          R PREC                      SPACEB(1)", "     A                                     2'X'"];
const next = [...lines];
for (const r of applyDdsEdits(lines, [{ kind: "addFileKeywords", keywords: "INDARA REF(QSYS/QADSPOBJ)" }], "DDS-PRTF")) next.splice(r.replaceFrom, r.replaceTo - r.replaceFrom, ...r.lines);
writeFileSync(here + "ADDFILE.prtf", next.join("\n") + "\n");
console.log(next.join("\n"));
