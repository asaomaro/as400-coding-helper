// 値の選択 UI が書く形（buildKeywordWithValues）で DDS を組み、実機に通す。値は原典から生成した一覧（dds-keywords.json）から選ぶ。
// 対照（*BAD）は原典の一覧に無い値。これが通るなら実機は値を検査していないことになり、確認にならない。
import { readFileSync, writeFileSync } from "node:fs";
const out = "/workspaces/as400-coding-helper/vscode-extension/out";
const { buildKeywordWithValues } = await import(`${out}/core/dds/ddsKeywordValues.js`);
const tables = JSON.parse(readFileSync("/workspaces/as400-coding-helper/vscode-extension/resources/completion/dds-keywords.json", "utf8"));
const HERE = new URL(".", import.meta.url).pathname;
const kw = (type, name, selections) => buildKeywordWithValues(name, tables[type].find(e => e.name === name).values, selections);
const line = (name, len, type, usage, row, col, keywords) => {
  const c = Array(80).fill(" "); const put = (s, t) => [...t].forEach((ch, i) => (c[s - 1 + i] = ch));
  put(6, "A"); if (name) put(19, name); if (len) put(35 - len.length, len); if (type) put(35, type); if (usage) put(38, usage);
  if (["S", "Y", "P"].includes(type)) put(37, "0");
  if (row) put(42 - row.length, row); if (col) put(45 - col.length, col); if (keywords) put(45, keywords);
  return c.join("").trimEnd();
};
const dspf = [
  line("", "", "", "", "", "", "DSPSIZ(24 80 *DS3)"),
  line("", "", "", "", "", "", kw("DDS-DSPF", "CHGINPDFT", [["HI", "CS"]])),
  "     A          R REC",
  line("F1", "10", "A", "B", "2", "2", kw("DDS-DSPF", "DSPATR", [["RI", "HI", "PC"]])),
  line("F2", "10", "A", "B", "3", "2", kw("DDS-DSPF", "COLOR", [["BLU"]])),
  line("F3", "10", "A", "I", "4", "2", kw("DDS-DSPF", "CHECK", [["ME", "FE"]])),
  line("F4", "5", "Y", "B", "5", "2", kw("DDS-DSPF", "COMP", [["GT"], ["0"]])),
  line("F5", "7", "Y", "O", "6", "2", kw("DDS-DSPF", "EDTCDE", [["J"], []])),
  line("F6", "", "L", "B", "7", "2", kw("DDS-DSPF", "DATFMT", [["*ISO"]])),
  line("", "", "", "", "8", "2", kw("DDS-DSPF", "DATE", [["*SYS"], ["*YY"]])),
  line("F7", "", "T", "B", "9", "2", kw("DDS-DSPF", "TIMFMT", [["*HMS"]])),
  line("", "", "", "", "", "", kw("DDS-DSPF", "TIMSEP", [["*JOB"]]))
];
const prtf = [
  "     A          R PREC",
  line("P1", "10", "A", "", "", "2", `${kw("DDS-PRTF", "COLOR", [["BRN"]])} SPACEA(1)`),
  line("P2", "7", "S", "", "", "2", kw("DDS-PRTF", "EDTCDE", [["Z"], []])),
  line("", "", "", "", "", "20", kw("DDS-PRTF", "DATE", [["*JOB"], []]))
];
const pf = [
  "     A          R PFREC",
  line("K1", "5", "S", "", "", "", kw("DDS-PF", "CHECK", [["M10"]])),
  line("K2", "", "L", "", "", "", kw("DDS-PF", "DATFMT", [["*JIS"]])),
  line("K3", "5", "S", "", "", "", kw("DDS-PF", "EDTCDE", [["3"], []]))
];
writeFileSync(`${HERE}KWVALD.dspf`, dspf.join("\n") + "\n");
writeFileSync(`${HERE}KWVALP.prtf`, prtf.join("\n") + "\n");
writeFileSync(`${HERE}KWVALF.pf`, pf.join("\n") + "\n");
writeFileSync(`${HERE}KWVBAD.dspf`, [dspf[0], dspf[2], line("F1", "10", "A", "B", "2", "2", "COLOR(PURPLE)"), line("F2", "10", "A", "B", "3", "2", "DSPATR(ZZ)"), ""].join("\n"));
console.log([...dspf, "", ...prtf, "", ...pf].join("\n"));
