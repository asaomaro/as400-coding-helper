// エディタと同じ経路（applyDdsEdits の conditionKeyword）で、サブファイル制御の様式キーワードと項目の COLOR に条件を付けた画面を書く。
import { writeFileSync } from "node:fs";
import { applyDdsEdits } from "../../../../vscode-extension/out/core/dds/ddsEdit.js";
import { parseKeywordEntries } from "../../../../vscode-extension/out/core/dds/ddsKeywords.js";
import { toLogicalUnits } from "../../../../vscode-extension/out/core/dds/ddsLogicalUnits.js";
const here = new URL(".", import.meta.url).pathname;
let lines = [
  "     A                                      DSPSIZ(24 80 *DS3) CA03(03)",
  "     A          R SFL01                     SFL",
  "     A            F1            10A  O  5  2COLOR(RED) DSPATR(HI)",
  "     A          R CTL01                     SFLCTL(SFL01)",
  "     A                                      SFLSIZ(0010) SFLPAG(0005)",
  "     A                                      SFLDSP SFLDSPCTL SFLCLR SFLEND",
  "     A                                  1  2'SUBFILE'"
];
const apply = (sourceLine, name, indicator) => {
  const unit = toLogicalUnits(lines).find(u => u.sourceLine === sourceLine);
  const index = parseKeywordEntries(unit.keywords).findIndex(e => e.name === name);
  const edit = { kind: "conditionKeyword", sourceLine, index, condition: [[{ indicator, negated: indicator.startsWith("N") }].map(t => ({ indicator: t.indicator.replace(/^N/, ""), negated: t.negated }))] };
  const results = applyDdsEdits(lines, [edit], "DDS-DSPF");
  if (results.length === 0) throw new Error(`拒否: ${name}`);
  const next = [...lines];
  for (const r of results) next.splice(r.replaceFrom, r.replaceTo - r.replaceFrom, ...r.lines);
  lines = next;
};
apply(3, "COLOR", "40");
const ctl = () => toLogicalUnits(lines).find(u => /R CTL01/.test(u.line)).sourceLine;
apply(ctl(), "SFLDSP", "31");
apply(ctl(), "SFLDSPCTL", "32");
apply(ctl(), "SFLCLR", "33");
apply(ctl(), "SFLEND", "34");
writeFileSync(here + "CONDKW.dspf", lines.join("\n") + "\n");
console.log(lines.join("\n"));
