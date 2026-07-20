#!/usr/bin/env node
/**
 * 印刷装置ファイルの編集コード（EDTCDE）の属性表を原典から生成する。
 *
 * 生成物は `resources/completion/dds-editcodes.json`。印刷幅の計算は
 * `src/core/dds/editCode.ts` が**この属性から導出**する。表そのものは
 * 原典が持っているので手で書かない（AGENTS.md）。
 *
 * ■ 空セルは「なし」を意味する
 *   早見表はコンマ・小数点の欄を、該当しないとき**空セル**にしている。
 *   HTML をテキスト化してから読むと空セルが消えて列がずれるため、
 *   **<td> を数えて位置で読む**。実際 `3` と `4` はコンマ欄が空で、
 *   テキスト化すると `1`/`2` と区別が付かなくなる。
 *
 * ■ ユーザー定義の編集コード 5-9 は対象外
 *   実機の `*EDTD` オブジェクトなのでソースからは決められない。原典も別ページ。
 *
 * 使い方:  node docs/origin/generate-dds-editcodes.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const ORIGIN = join(HERE, "dds/PRTF-EDITCODES.html");
const OUT = join(
  ROOT,
  "vscode-extension/resources/completion/dds-editcodes.json"
);

/** 早見表の列。原典の並び。 */
const COLUMN = {
  code: 0,
  commas: 1,
  decimalPoint: 2,
  negativeSign: 3,
  zeroBalanceBlank: 4, // QDECFMT がブランクのときのゼロ残高
  suppressLeadingZero: 7
};

function cellsOf(rowHtml) {
  return [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gu)].map(match =>
    match[1]
      // 脚注の <sup>2</sup> を先に落とす。残すと "W2" のように
      // 編集コードにくっついて読めなくなる。
      .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gu, "")
      .replace(/<[^>]+>/gu, "")
      .replace(/&nbsp;/gu, " ")
      .replace(/&#?\w+;/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
  );
}

function parseNegativeSign(text) {
  if (text.includes("CR")) return "CR";
  if (text.includes("-") || text.includes("マイナス")) return "minus";
  return "none";
}

const html = readFileSync(ORIGIN, "utf8");

// 「早見表」の見出しに続く表を採る。ページには他にも表があるため位置で絞る。
const headingIndex = html.indexOf("早見表");
if (headingIndex < 0) {
  console.error("✗ 原典に「早見表」が見つからない");
  process.exit(1);
}
const tableStart = html.indexOf("<table", headingIndex - 3000);
const tableEnd = html.indexOf("</table>", tableStart);
if (tableStart < 0 || tableEnd < 0) {
  console.error("✗ 早見表の <table> が読めない");
  process.exit(1);
}

const rows = [...html.slice(tableStart, tableEnd).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gu)]
  .map(match => cellsOf(match[1]))
  .filter(cells => cells.length > 0);

const header = rows.shift();
if (!header || header[COLUMN.code] !== "編集コード") {
  console.error(`✗ 表の見出しが想定と違う: ${JSON.stringify(header)}`);
  process.exit(1);
}

const editCodes = {};
for (const cells of rows) {
  // 表の最後に脚注の行（セル 1 つ）が入る。データ行ではないので飛ばす。
  if (cells.length === 1) continue;

  // 列数が揺れたら位置で読めなくなる。黙って誤った値を作らないよう弾く。
  if (cells.length !== header.length) {
    console.error(
      `✗ 列数が見出しと違う（${cells.length} / ${header.length}）: ${JSON.stringify(cells)}`
    );
    process.exit(1);
  }

  const code = cells[COLUMN.code].toUpperCase();
  if (!/^[0-9A-Z]$/u.test(code)) {
    console.error(`✗ 編集コードとして読めない: ${JSON.stringify(code)}`);
    process.exit(1);
  }

  editCodes[code] = {
    // 空セル＝「なし」。テキスト化して読むとここが消える。
    commas: cells[COLUMN.commas] === "あり",
    decimalPoint: cells[COLUMN.decimalPoint] === "あり",
    negativeSign: parseNegativeSign(cells[COLUMN.negativeSign]),
    zeroBalance: cells[COLUMN.zeroBalanceBlank] === "ブランク" ? "blank" : "zero",
    suppressLeadingZero: cells[COLUMN.suppressLeadingZero] === "あり"
  };
}

/*
 * 原典は本文で「1 から 4 / A から D / J から Q / W から Z」と宣言しているが、
 * **早見表には X が無い**（W / Y / Z のみ）。X は別の注記で
 *   「IBM i ハードウェアは優先符号 F で動作します。これは、編集コード X を
 *     使用するのと同じです。」
 * と説明されており、編集をしない＝桁数が変わらないコード。
 * 表に無いことを黙って見逃すと X が「知らないコード」になって幅不明に落ちるため、
 * ここで明示的に補い、宣言との差は検査で見張る（verify-dds-editcodes.mjs）。
 */
const DECLARED = [
  ..."1234".split(""),
  ..."ABCD".split(""),
  ..."JKLMNOPQ".split(""),
  ..."WXYZ".split("")
];

if (!editCodes.X) {
  editCodes.X = {
    commas: false,
    decimalPoint: false,
    negativeSign: "none",
    zeroBalance: "zero",
    suppressLeadingZero: false,
    // 表に無く注記から補ったことを残す。
    fromNote: "編集コード X は優先符号 F と同じ（編集しない）。早見表に行が無い"
  };
}

const missing = DECLARED.filter(code => !editCodes[code]);
if (missing.length > 0) {
  console.error(`✗ 原典が宣言しているのに表に無い編集コード: ${missing.join(" ")}`);
  process.exit(1);
}

const unexpected = Object.keys(editCodes).filter(code => !DECLARED.includes(code));
if (unexpected.length > 0) {
  console.error(`✗ 宣言に無い編集コードが表にある: ${unexpected.join(" ")}`);
  process.exit(1);
}

const payload = {
  note:
    "印刷装置ファイルの EDTCDE 早見表。docs/origin/generate-dds-editcodes.mjs が " +
    "原典から生成する。印刷幅は src/core/dds/editCode.ts がこの属性から導出する。",
  source: "IBM Documentation ssw_ibm_i_74/rzakd/os400edits.htm",
  declaredCodes: DECLARED,
  userDefinedCodes: ["5", "6", "7", "8", "9"],
  userDefinedNote:
    "5-9 は実機の *EDTD オブジェクト（ユーザー定義）。ソースからは決められない。",
  editCodes
};

writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`編集コード: ${Object.keys(editCodes).length} 件`);
console.log(`出力: ${OUT.replace(`${ROOT}/`, "")}`);
