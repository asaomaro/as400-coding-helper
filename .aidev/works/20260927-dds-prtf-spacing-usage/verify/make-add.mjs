// エディタの「置く」と同じ経路（applyDdsEdits の add）で、行送りの様式に定数とフィールドを置いた帳票を書く。
import { writeFileSync } from "node:fs";
import { applyDdsEdits } from "../../../../vscode-extension/out/core/dds/ddsEdit.js";
const here = new URL(".", import.meta.url).pathname;
let lines = [
  "     A          R PHEAD                     SKIPB(3)",
  "     A          R PDETL                     SPACEA(1)"
];
const add = (recordName, item) => {
  const results = applyDdsEdits(lines, [{ kind: "add", recordName, item }], "DDS-PRTF");
  if (results.length === 0) throw new Error(`置けない: ${JSON.stringify(item)}`);
  const next = [...lines];
  for (const r of results) next.splice(r.replaceFrom, r.replaceTo - r.replaceFrom, ...r.lines);
  lines = next;
};
add("PHEAD", { kind: "constant", text: "ADDTEST", row: 3, column: 2 });
add("PDETL", { kind: "field", name: "CUSTNO", length: 6, dataType: "A", row: 5, column: 2 });
add("PDETL", { kind: "constant", text: "END", row: 5, column: 20 });
writeFileSync(here + "ADDP.prtf", lines.join("\n") + "\n");
console.log(lines.join("\n"));
