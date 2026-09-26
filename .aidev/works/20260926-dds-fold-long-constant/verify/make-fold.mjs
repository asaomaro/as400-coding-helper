// 長い定数を buildItemLines（エディタの「定数を置く」と同じ経路）で組み、実機確認用の DSPF / PRTF / RPG を書く
import { writeFileSync } from "node:fs";
import { buildItemLines, buildRecordLine } from "../../../../vscode-extension/out/core/dds/ddsEditWriteBack.js";
const here = new URL(".", import.meta.url).pathname;
const sbcs = "-".repeat(80), dbcs = "─".repeat(38);
const kw = t => "     A" + " ".repeat(38) + t;
const dspf = [kw("DSPSIZ(24 80 *DS3) CA03(03)"), buildRecordLine("REC"),
  ...buildItemLines({ kind: "constant", text: sbcs, row: 3, column: 1 }),
  ...buildItemLines({ kind: "constant", text: dbcs, row: 5, column: 2 }),
  ...buildItemLines({ kind: "constant", text: "FOLDTEST END", row: 7, column: 2 })];
writeFileSync(here + "FOLDD.dspf", dspf.join("\n") + "\n");
const prtf = [buildRecordLine("PREC") + "".padEnd(0), kw("SPACEB(1)"),
  ...buildItemLines({ kind: "constant", text: sbcs, row: 1, column: 1 }).map(l => l.slice(0, 38) + "   " + l.slice(41)),
  buildRecordLine("PREC2"), kw("SPACEB(1)"),
  ...buildItemLines({ kind: "constant", text: dbcs, row: 1, column: 2 }).map(l => l.slice(0, 38) + "   " + l.slice(41))];
// 帳票は行送りで行を決める（行番号を書かない。帳票 P1 は別の work）
const joinSpace = lines => lines.flatMap((l, i) => l.includes("SPACEB(1)") && i > 0 && /R PREC/.test(lines[i - 1]) ? [] : [/R PREC/.test(l) ? l.padEnd(44) + "SPACEB(1)" : l]);
writeFileSync(here + "FOLDP.prtf", joinSpace(prtf).join("\n") + "\n");
writeFileSync(here + "FOLDR.rpgle", ["     FFOLDD     CF   E             WORKSTN", "     C                   EXFMT     REC", "     C                   SETON                                        LR", ""].join("\n"));
writeFileSync(here + "FOLDPR.rpgle", ["     FFOLDP     O    E             PRINTER", "     C                   WRITE     PREC", "     C                   WRITE     PREC2", "     C                   SETON                                        LR", ""].join("\n"));
console.log(dspf.join("\n")); console.log("---"); 
