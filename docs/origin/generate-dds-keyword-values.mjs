#!/usr/bin/env node
/**
 * DDS キーワードの**書ける値の一覧**（`COLOR(RED)` の `RED`、`DSPATR(HI RI)` の `HI` `RI`）を、
 * 各キーワードの詳細ページから抜き出して補完データ（`resources/completion/dds-keywords*.json`）の
 * `values` に入れる。エディタはこれを見て、キーワードの値をドロップダウン／チェックボックスで選ばせる
 * （2026-09-27 利用者の依頼。範囲は「値が決まっているもの全部」、複数の値はチェックボックス）。
 *
 * ## 値の置き場は 4 通り（原典の書き方がキーワードごとに違う）
 *
 * - `syntax`  … 構文の `A | B | C`（`COLOR(GRN | WHT | …)`・`DATE([*JOB|*SYS] [*Y|*YY])`）。
 *               小文字の語（`nn` / `'date-separator'`）は「その他の値も書ける」印として扱い、値には入れない。
 * - `dl`      … 定義リスト（`<dt>BL</dt><dd>明滅フィールド</dd>`）。同じ値が 2 度出るページ（DSPATR は要約と詳細）では
 *               **先に出た短い説明**を採る。
 * - `table`   … 表（`DATFMT` の「日付形式パラメーター」列、`CHGINPDFT` の「パラメーター値」列）。
 * - `summary` … 「機能 → 有効なパラメーター値」の要約（画面の `CHECK`。`AB、ME、MF、…` と並ぶ）。
 *
 * 対象にしないもの（値が自由・形が入れ子で 1 つの選択にならない）は `EXCLUDED` に理由を書く。
 *
 * 使い方:  node docs/origin/generate-dds-keyword-values.mjs          # 書く（ja / en）
 *          node docs/origin/generate-dds-keyword-values.mjs --check  # 書かずに一致を見る（差分があれば終了コード 1）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const COMPLETION = join(ROOT, "vscode-extension/resources/completion");
const CHECK = process.argv.includes("--check");

const decode = text =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&reg;/g, "®")
    .replace(/&amp;/g, "&");
const strip = html =>
  decode(String(html).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    // 原典の改行で日本語の語の間に入った空白（「国際 標準化機構」）を詰める。
    .replace(/(?<=[\u3000-\u9fff\uff00-\uffef]) (?=[\u3000-\u9fff\uff00-\uffef])/gu, "")
    .trim();

const INDEXES = {
  "DDS-PF": ["PF-LF-KEYWORDS.html"],
  "DDS-DSPF": ["DSPF-KEYWORDS.html", "DSPF-DBCS-KEYWORDS.html"],
  "DDS-PRTF": ["PRTF-KEYWORDS.html"]
};

/** 索引から「キーワード名 → 詳細ページ」（`generate-dds-keyword-syntax.mjs` と同じ読み方）。 */
function detailPaths(lang, type) {
  const dir = join(HERE, lang === "ja" ? "dds" : `dds-${lang}`);
  const map = new Map();
  for (const file of INDEXES[type]) {
    const html = readFileSync(join(dir, file), "utf8");
    for (const match of html.matchAll(/href="[^"]*\/(rzak[bcd]\/[a-z0-9_]+\.htm)[^"]*"[^>]*>([\s\S]{0,90}?)<\/a>/g)) {
      const names = /([A-Z][A-Z0-9]*(?:nn)?(?:\/[A-Z][A-Z0-9]*(?:nn)?)*)\s*[（(]/.exec(strip(match[2]));
      if (!names) continue;
      for (const name of names[1].split("/")) {
        if (name.length >= 2 && !map.has(name)) map.set(name, join(dir, "detail", match[1].replace("/", "_")));
      }
    }
  }
  return map;
}

/** 説明の最初の句（ラベルに使う）。 */
function headline(text) {
  const cleaned = text.replace(/^[-–]\s*/u, "").trim();
  const sentence = cleaned.split(/。|\.\s|\.$/u)[0].trim();
  return sentence.length <= 40 ? sentence : `${sentence.slice(0, 40)}…`;
}

const VALUE = /^\*?[A-Z0-9][A-Z0-9]*$/u;

/** 構文の `A | B` の組を順に読む。小文字・引用符の語は「その他の値」。 */
function syntaxGroups(syntax) {
  const groups = [];
  for (const match of syntax.matchAll(/[^\s|()[\]{}]+(?:\s*\|\s*[^\s|()[\]{}]+)+/gu)) {
    const words = match[0].split("|").map(word => word.trim());
    groups.push({
      choices: words.filter(word => VALUE.test(word)).map(value => ({ value })),
      other: words.some(word => !VALUE.test(word))
    });
  }
  return groups;
}

/**
 * 定義リストの「値 → 説明」。先に出たものを採る。
 *
 * - `BL (明滅)` の形は括弧の前が値。
 * - `M10/M10F または M11/M11F (IBM モジュラス …)` のように 1 つの項目に値が並ぶものは、括弧の中を全部のラベルにする。
 * - 説明は `<dd>` の**最初の段落（`<p>` / `<div>` など）より前**（`ブランク使用可能<p>これは…`）。無ければ全体の最初の句。
 * - 数字だけの値は、他が語の値なら使用例の番号なので捨てる（`COMP` の例の注 1・2）。
 */
function dlChoices(html) {
  const choices = new Map();
  for (const match of html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)) {
    const term = strip(match[1]);
    const parsed = /^(\*?[A-Z0-9][A-Z0-9]*(?:\s*(?:\/|または|or|,)\s*\*?[A-Z0-9][A-Z0-9]*)*)(?:\s*[（(]([^)）]+)[)）])?$/u.exec(term);
    if (!parsed) continue;
    const values = parsed[1].split(/\s*(?:\/|または|or|,)\s*/u);
    const lead = strip(match[2].split(/<(?:p|div|ul|ol|table)[\s>]/u)[0]);
    const label = headline(values.length > 1 ? parsed[2] ?? lead : lead.length > 0 ? lead : parsed[2] ?? strip(match[2]));
    for (const value of values) if (!choices.has(value)) choices.set(value, label);
  }
  const words = [...choices.keys()].filter(value => !/^\d+$/u.test(value));
  if (words.length > 0) for (const value of [...choices.keys()]) if (/^\d+$/u.test(value)) choices.delete(value);
  return choices;
}

/** 表の行（セルのテキスト）。 */
function tableRows(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map(table =>
    [...table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(row =>
      [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(cell => strip(cell[1]))
    )
  );
}

/** 表のセルの値。脚注の番号（`*MDY 1` / `*MY 1 , 2`）は外す。 */
function cellValue(cell) {
  const match = /^(\*?[A-Z0-9][A-Z0-9]*)(?:\s+\d+(?:\s*,\s*\d+)*)?$/u.exec(cell ?? "");
  return match ? match[1] : undefined;
}

/**
 * 値の列を持つ表から（値の列は「値の形のセルが 3 つ以上ある最初の列」）。ラベルは `labelColumn`。
 * 表が複数あれば**合わせる**（物理/論理の `DATFMT` は日付フィールド用と論理ファイルのゾーン・文字フィールド用の 2 表で、
 * 書ける値はその和。どちらが使えるかはフィールドの型で決まる）。
 */
function tableChoices(html, labelColumn) {
  const choices = new Map();
  for (const rows of tableRows(html)) {
    const width = Math.max(...rows.map(row => row.length));
    for (let column = 0; column < width; column += 1) {
      const values = rows.slice(1).filter(row => cellValue(row[column]) !== undefined);
      if (values.length < 3) continue;
      for (const row of values) {
        const value = cellValue(row[column]);
        if (!choices.has(value)) choices.set(value, headline(row[labelColumn] ?? ""));
      }
      break;
    }
  }
  return [...choices].map(([value, label]) => ({ value, label }));
}

/** 「機能 → 有効なパラメーター値」の要約（`AB、ME、MF` / `AB, ME, MF`）。ラベルは定義リストから。 */
function summaryChoices(html) {
  const labels = dlChoices(html);
  const values = [];
  for (const match of html.matchAll(/<dt[^>]*>[\s\S]*?<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)) {
    const words = strip(match[1]).split(/\s*[、,]\s*/u);
    if (words.length >= 2 && words.every(word => VALUE.test(word))) values.push(...words);
  }
  return values.map(value => ({ value, label: labels.get(value) ?? "" }));
}

/** 編集コード（早見表から生成済みのもの。ユーザー定義 5-9 は実機の *EDTD なので入れない）。 */
function editCodeChoices(lang) {
  const data = JSON.parse(readFileSync(join(COMPLETION, "dds-editcodes.json"), "utf8"));
  return data.declaredCodes.map(code => {
    const attributes = data.editCodes[code];
    const parts = lang === "ja"
      ? [attributes.commas ? "コンマあり" : "コンマなし", attributes.negativeSign === "none" ? "符号なし" : `負符号 ${attributes.negativeSign}`]
      : [attributes.commas ? "commas" : "no commas", attributes.negativeSign === "none" ? "no sign" : `sign ${attributes.negativeSign}`];
    return { value: code, label: attributes ? parts.join(lang === "ja" ? "・" : ", ") : "" };
  });
}

/**
 * 対象。`slots` は値の並び（書く順）。各スロットは:
 *   from: 値の出どころ / multiple: 複数並べられる（チェックボックス）/ optional: 省ける / other: 一覧に無い値も書ける
 *   page: 別のキーワードのページを使う（`CMP` は `COMP` の同義語で、値は `COMP` のページにある）
 */
const TARGETS = [
  // ---- 画面（DSPF）----
  { type: "DDS-DSPF", keyword: "COLOR", slots: [{ from: "syntax", group: 0 }] },
  { type: "DDS-DSPF", keyword: "DSPATR", slots: [{ from: "dl", multiple: true }] },
  { type: "DDS-DSPF", keyword: "CHECK", slots: [{ from: "summary", multiple: true }] },
  { type: "DDS-DSPF", keyword: "CHGINPDFT", slots: [{ from: "table", labelColumn: 2, multiple: true, optional: true }] },
  { type: "DDS-DSPF", keyword: "COMP", slots: [{ from: "dl" }, { from: "text" }] },
  { type: "DDS-DSPF", keyword: "CMP", page: "COMP", slots: [{ from: "dl" }, { from: "text" }] },
  { type: "DDS-DSPF", keyword: "DATFMT", slots: [{ from: "table", labelColumn: 0 }] },
  { type: "DDS-DSPF", keyword: "TIMFMT", slots: [{ from: "table", labelColumn: 0 }] },
  { type: "DDS-DSPF", keyword: "DATSEP", slots: [{ from: "syntax", group: 0 }] },
  { type: "DDS-DSPF", keyword: "TIMSEP", slots: [{ from: "syntax", group: 0 }] },
  { type: "DDS-DSPF", keyword: "DATE", slots: [{ from: "syntax", group: 0, optional: true }, { from: "syntax", group: 1, optional: true }] },
  { type: "DDS-DSPF", keyword: "EDTCDE", slots: [{ from: "editcodes" }, { from: "fixed", values: ["*"], optional: true, other: true }] },
  { type: "DDS-DSPF", keyword: "ERASEINP", slots: [{ from: "syntax", group: 0, optional: true }] },
  { type: "DDS-DSPF", keyword: "MDTOFF", slots: [{ from: "syntax", group: 0, optional: true }] },
  { type: "DDS-DSPF", keyword: "MNUBAR", slots: [{ from: "syntax", group: 0, optional: true }] },
  { type: "DDS-DSPF", keyword: "PULLDOWN", slots: [{ from: "syntax", group: 0, optional: true }] },
  { type: "DDS-DSPF", keyword: "FLTPCN", slots: [{ from: "syntax", group: 0 }] },
  { type: "DDS-DSPF", keyword: "CLRL", slots: [{ from: "syntax", group: 0 }] },
  { type: "DDS-DSPF", keyword: "SLNO", slots: [{ from: "syntax", group: 0 }] },
  // ---- 物理・論理（PF / LF）----
  { type: "DDS-PF", keyword: "CHECK", slots: [{ from: "dl", multiple: true }] },
  { type: "DDS-PF", keyword: "COMP", slots: [{ from: "dl" }, { from: "text" }] },
  { type: "DDS-PF", keyword: "CMP", page: "COMP", slots: [{ from: "dl" }, { from: "text" }] },
  { type: "DDS-PF", keyword: "DATFMT", slots: [{ from: "table", labelColumn: 0 }] },
  { type: "DDS-PF", keyword: "TIMFMT", slots: [{ from: "table", labelColumn: 0 }] },
  { type: "DDS-PF", keyword: "DATSEP", slots: [{ from: "syntax", group: 0 }] },
  { type: "DDS-PF", keyword: "TIMSEP", slots: [{ from: "syntax", group: 0 }] },
  { type: "DDS-PF", keyword: "EDTCDE", slots: [{ from: "editcodes" }, { from: "fixed", values: ["*"], optional: true, other: true }] },
  { type: "DDS-PF", keyword: "FLTPCN", slots: [{ from: "syntax", group: 0 }] },
  { type: "DDS-PF", keyword: "UNIQUE", slots: [{ from: "syntax", group: 0, optional: true }] },
  // ---- 帳票（PRTF）----
  { type: "DDS-PRTF", keyword: "COLOR", slots: [{ from: "table", labelColumn: 1 }] },
  { type: "DDS-PRTF", keyword: "CPI", slots: [{ from: "syntax", group: 0 }] },
  { type: "DDS-PRTF", keyword: "LPI", slots: [{ from: "syntax", group: 0 }] },
  { type: "DDS-PRTF", keyword: "PAGRTT", slots: [{ from: "syntax", group: 0 }] },
  { type: "DDS-PRTF", keyword: "DATE", slots: [{ from: "syntax", group: 0, optional: true }, { from: "syntax", group: 1, optional: true }] },
  { type: "DDS-PRTF", keyword: "DATFMT", slots: [{ from: "table", labelColumn: 0 }] },
  { type: "DDS-PRTF", keyword: "TIMFMT", slots: [{ from: "table", labelColumn: 0 }] },
  { type: "DDS-PRTF", keyword: "DATSEP", slots: [{ from: "syntax", group: 0 }] },
  { type: "DDS-PRTF", keyword: "TIMSEP", slots: [{ from: "syntax", group: 0 }] },
  { type: "DDS-PRTF", keyword: "EDTCDE", slots: [{ from: "editcodes" }, { from: "fixed", values: ["*"], optional: true, other: true }] },
  { type: "DDS-PRTF", keyword: "FLTPCN", slots: [{ from: "syntax", group: 0 }] },
  { type: "DDS-PRTF", keyword: "DUPLEX", slots: [{ from: "dl", other: true }] }
];

/**
 * 対象にしないもの（値の一覧を持つが、1 つの選択・チェックボックスの形にならない）。理由を書く。
 * 新しく対象にするときは、ここから外して `TARGETS` に足す。
 */
export const EXCLUDED = {
  "CHCAVAIL / CHCSLT / CHCUNAVAIL / ENTFLDATR / MNUBARSEP / WDWBORDER / WDWTITLE":
    "値が `(*COLOR BLU) (*DSPATR HI)` の入れ子の組で、1 つの選択肢の並びにならない",
  "GRDATR / GRDBOX / GRDLIN / GRDCLR": "罫線はキャンバスで引き、プロパティで色・線種・形を選ぶ（dspfGrid）",
  "SFLEND / SFLRCDNBR / SFLSNGCHC / SFLMLTCHC / SNGCHCFLD / MLTCHCFLD / PSHBTNFLD / RTNCSRLOC / UNLOCK / AUTO":
    "値の組み合わせに順序・排他の規則があり（`*SCRBAR [*PLUS|*MORE]`・`RA [RAB|RAZ]`）、並べるだけでは正しい形にならない",
  "ZFOLD / BARCODE / MOUBTN": "位置ごとに別の値の集合を取り、原典の一覧は 1 つにまとまっている（どれがどの位置か機械的に分けられない）",
  "DSPSIZ / DSPMOD": "画面サイズは 2 次画面・条件名の宣言と結びついており、`DSPSIZ` の編集は別の画面（2 次画面）で扱う",
  "REFSHIFT": "値の集合がフィールドの型（文字・数字）で変わる"
};

function buildSlots(target, lang, paths, entry) {
  const page = paths.get(target.page ?? target.keyword);
  const html = page ? readFileSync(page, "utf8") : "";
  if (!page) throw new Error(`${lang} ${target.type} ${target.keyword}: 詳細ページが索引に無い`);
  const syntax = (entry.syntax ?? [])[0] ?? "";
  const groups = syntaxGroups(syntax);
  const labels = dlChoices(html);

  return target.slots.map(slot => {
    let choices;
    let other = slot.other === true;
    switch (slot.from) {
      case "syntax": {
        const group = groups[slot.group];
        if (!group) throw new Error(`${lang} ${target.keyword}: 構文 "${syntax}" に ${slot.group} 番目の選択が無い`);
        choices = group.choices.map(choice => ({ value: choice.value, label: labels.get(choice.value) ?? "" }));
        other = other || group.other;
        break;
      }
      case "dl":
        choices = [...labels].map(([value, label]) => ({ value, label }));
        break;
      case "table":
        choices = tableChoices(html, slot.labelColumn);
        break;
      case "summary":
        choices = summaryChoices(html);
        break;
      case "editcodes":
        choices = editCodeChoices(lang);
        break;
      case "fixed":
        choices = slot.values.map(value => ({ value, label: "" }));
        break;
      case "text":
        choices = [];
        other = true;
        break;
      default:
        throw new Error(`未知の出どころ ${slot.from}`);
    }
    if (slot.from !== "text" && choices.length === 0) {
      throw new Error(`${lang} ${target.type} ${target.keyword}: 値が 1 つも取れない（${slot.from}）`);
    }
    // 原典のページの本文に値が語として現れることを確かめる（取り違えの検出）。
    if (["dl", "table", "summary"].includes(slot.from)) {
      const text = ` ${strip(html)} `;
      for (const choice of choices) {
        if (!text.includes(choice.value)) throw new Error(`${lang} ${target.keyword}: 値 ${choice.value} がページに無い`);
      }
    }
    return {
      ...(slot.multiple ? { multiple: true } : {}),
      ...(slot.optional ? { optional: true } : {}),
      ...(other ? { other: true } : {}),
      choices: choices.map(choice => (choice.label ? choice : { value: choice.value }))
    };
  });
}

const differences = [];
const results = {};
for (const lang of ["ja", "en"]) {
  const file = join(COMPLETION, lang === "ja" ? "dds-keywords.json" : "dds-keywords.en.json");
  const data = JSON.parse(readFileSync(file, "utf8"));
  const pathsByType = Object.fromEntries(Object.keys(INDEXES).map(type => [type, detailPaths(lang, type)]));
  for (const target of TARGETS) {
    const entry = data[target.type].find(candidate => candidate.name === target.keyword);
    if (!entry) throw new Error(`${lang} ${target.type} ${target.keyword}: 補完データに無い`);
    const values = buildSlots(target, lang, pathsByType[target.type], entry);
    if (JSON.stringify(entry.values) !== JSON.stringify(values)) differences.push(`${lang} ${target.type} ${target.keyword}`);
    entry.values = values;
  }
  results[lang] = { file, data };
}

// 日英で値（ラベルではなく値そのもの）が同じであること。ずれると言語で書ける値が変わる。
for (const target of TARGETS) {
  const pick = lang => JSON.stringify(
    results[lang].data[target.type].find(entry => entry.name === target.keyword).values.map(slot => slot.choices.map(choice => choice.value))
  );
  if (pick("ja") !== pick("en")) throw new Error(`${target.type} ${target.keyword}: 日英で値が違う（ja ${pick("ja")} / en ${pick("en")}）`);
}

if (CHECK) {
  if (differences.length > 0) {
    console.error("原典の値と補完データが食い違う。generate-dds-keyword-values.mjs を流し直すこと:");
    for (const line of differences) console.error(`  - ${line}`);
    process.exit(1);
  }
  console.log(`✓ DDS キーワードの値は原典と一致（${TARGETS.length} 件 × 日英）`);
} else {
  for (const { file, data } of Object.values(results)) writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`書き換えた: ${differences.length} 件`);
  for (const line of differences) console.log(`  - ${line}`);
}
