// エディタの属性変更と同じ経路（applyDdsEdits の setAttributes）で使用を H にした画面を書く（2 次画面の上書き行つき）。
import { writeFileSync } from "node:fs";
import { applyDdsEdits } from "../../../../vscode-extension/out/core/dds/ddsEdit.js";
const here = new URL(".", import.meta.url).pathname;
const lines = [
  "     A                                      DSPSIZ(24 80 *DS3 27 132 *DS4)",
  "     A          R REC",
  "     A            FLDA          10A  B  5  2",
  "     A  *DS4                            6  6",
  "     A            FLDB          10A  B  8  2"
];
const next = [...lines];
for (const r of applyDdsEdits(lines, [{ kind: "setAttributes", sourceLine: 3, attributes: { usage: "H" } }], "DDS-DSPF")) {
  next.splice(r.replaceFrom, r.replaceTo - r.replaceFrom, ...r.lines);
}
writeFileSync(here + "HIDEN.dspf", next.join("\n") + "\n");
console.log(next.join("\n"));
