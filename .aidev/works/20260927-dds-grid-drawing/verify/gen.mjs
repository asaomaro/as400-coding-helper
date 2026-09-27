// エディタが書く罫線のキーワード（applyDdsEdits の addGrid / setGridKeyword）で DSPF を組み、実機に通す。
// 対照として、原典に無い形（*TYPE BOGUS）を別のメンバーにする。
import { writeFileSync } from "node:fs";
const out = "/workspaces/as400-coding-helper/vscode-extension/out";
const { applyDdsEdits } = await import(`${out}/core/dds/ddsEdit.js`);
const { buildGridKeyword, rewriteGridKeyword } = await import(`${out}/core/dds/dspfGrid.js`);
const { resolveDspfLayout } = await import(`${out}/core/dds/dspfLayout.js`);
const { resolveScreenSizes } = await import(`${out}/core/dds/dspfScreenSize.js`);
const HERE = new URL(".", import.meta.url).pathname;

const apply = (lines, edits) => {
  const after = [...lines];
  for (const r of applyDdsEdits(lines, edits, "DDS-DSPF")) after.splice(r.replaceFrom, r.replaceTo - r.replaceFrom, ...r.lines);
  return after;
};
let lines = [
  "     A                                      DSPSIZ(24 80 *DS3)",
  "     A          R HEAD",
  "     A                                  1  2'GRID TEST'"
];
// 罫線の様式が無い → 作って書く（ドラッグで引いた横線）。
lines = apply(lines, [{ kind: "addGrid", recordName: "LINES", keyword: buildGridKeyword({ kind: "line", row: 6, column: 10, length: 31, type: "LOWER" }), createRecord: true }]);
// ツールバーで色・線種を選んで引いた箱と縦線。
lines = apply(lines, [{ kind: "addGrid", recordName: "LINES", keyword: buildGridKeyword({ kind: "box", row: 15, column: 2, depth: 4, width: 19, type: "PLAIN" }, { color: "RED" }) }]);
lines = apply(lines, [{ kind: "addGrid", recordName: "LINES", keyword: buildGridKeyword({ kind: "line", row: 3, column: 60, length: 10, type: "RIGHT" }, { lineType: "DBL" }) }]);
lines = apply(lines, [{ kind: "addGrid", recordName: "LINES", keyword: buildGridKeyword({ kind: "box", row: 3, column: 2, depth: 3, width: 30, type: "PLAIN" }) }]);
// プロパティで形を HRZVRT に、ドラッグで 1 行下へ（書き換え）。
const size = resolveScreenSizes(lines).sizes.primary;
const box = resolveDspfLayout(lines).gridShapes.find(s => s.geometry.kind === "box" && s.geometry.row === 3);
lines = apply(lines, [{ kind: "setGridKeyword", sourceLine: box.recordLine, index: box.index,
  keyword: rewriteGridKeyword(box.raw, { ...box.geometry, row: 4, type: "HRZVRT", horizontalRule: 1, verticalRule: 10 }, size, { lineType: "DSH" }) }]);
writeFileSync(`${HERE}GRIDED.dspf`, lines.join("\n") + "\n");
// 対照: 原典に無い *TYPE。
writeFileSync(`${HERE}GRIDBAD.dspf`, [...lines.slice(0, 4), "     A                                      GRDBOX((*POS (2 2 3 10)) (*TYPE BOGUS))", ""].join("\n"));
console.log(lines.join("\n"));
