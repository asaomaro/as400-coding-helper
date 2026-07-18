#!/usr/bin/env node
/**
 * RPG 固定長仕様書の定義 JSON の桁位置を、原典と機械的に突き合わせる検査。
 *
 * 桁位置の正本は `docs/origin/ilerpg/<X>-SPEC-layout.html`（「従来型の〜
 * ステートメント」のトピック）。本文に「N 桁目 (ラベル)」の形で全桁が
 * 列挙されている。仕様書の入口ページには桁の一覧が無い。
 *
 * **範囲の一致だけで判定してはならない。** 項目名と原典のラベルを対応させて
 * 突き合わせる。例: F仕様書の FILEFMT は 19 桁目にあったが、19 桁目の原典
 * ラベルは「ファイルの終わり」で、「ファイル形式」は 22 桁目だった。
 * 範囲一致だけでは OK と誤判定する。
 *
 * 往復検証（vscode-extension の verify:roundtrip）は「読み書きで同じ桁定義を
 * 使う」ことしか見ないため、桁が誤っていても通る。桁の正誤はここでしか
 * 確定できない。
 *
 * 使い方:  node docs/origin/verify-rpg-definitions.mjs
 * 終了コード: 0=全件OK / 1=1件以上の不一致
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const ORIGIN = join(ROOT, "docs/origin/ilerpg");
const DEFS = join(ROOT, "vscode-extension/resources/prompter/rpg/ile");

const decode = text =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const plainText = file =>
  decode(readFileSync(file, "utf8").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

/** 原典本文から「N 桁目 (ラベル)」「N から M 桁目 (ラベル)」を集める。 */
function originColumns(spec) {
  const file = join(ORIGIN, `${spec}-SPEC-layout.html`);
  if (!existsSync(file)) return null;

  const text = plainText(file);
  const columns = new Map();
  for (const [, from, to, label] of text.matchAll(
    /(\d+)\s*(?:から\s*(\d+)\s*)?桁目\s*\(([^)]+)\)/g
  )) {
    columns.set(label.trim(), [Number(from), Number(to ?? from)]);
  }

  // 注記欄は「仕様書の注記部分は N から M 桁目です」の形で書かれている。
  const comment = text.match(/注記部分は\s*(\d+)\s*から\s*(\d+)\s*桁目/);
  if (comment) columns.set("注記", [Number(comment[1]), Number(comment[2])]);

  return columns;
}

/**
 * 定義の項目名 → 原典のラベル。
 * 原典は日本語ラベルしか持たないため、この対応付けだけは人が与える必要がある。
 */
const LABELS = {
  "F-SPEC": {
    FILENAME: "ファイル名",
    FILETYPE: "ファイル・タイプ",
    FILEDESG: "ファイルの指定",
    ENDFILE: "ファイルの終わり",
    FILEADD: "ファイルの追加",
    SEQUENCE: "順序",
    FILEFMT: "ファイル形式",
    RECLEN: "レコード長",
    LIMITS: "限界内処理",
    KEYLEN: "キーまたはレコード・アドレスの長さ",
    RECADDR: "レコード・アドレス・タイプ",
    FILEORG: "ファイル編成",
    DEVICE: "装置",
    KEYWORDS: "キーワード",
    COMMENT: "注記"
  },
  "D-SPEC": {
    NAME: "名前",
    EFLAG: "外部記述",
    SU: "データ構造のタイプ",
    DECLTYPE: "定義タイプ",
    FROM: "開始位置",
    LEN: "終了位置/長さ",
    INTTYPE: "内部データ・タイプ",
    DEC: "小数点以下の桁数",
    KEYWORDS: "キーワード",
    COMMENT: "注記"
  },
  "C-SPEC": {
    CTLLEVEL: "制御レベル",
    INDICATORS: "標識",
    FACTOR1: "演算項目 1",
    OPCODE: "命令および拡張",
    FACTOR2: "演算項目 2",
    RESULT: "結果フィールド",
    FIELDLEN: "フィールド長",
    DECPOS: "小数点以下の桁数",
    RESULTIND: "結果標識",
    COMMENT: "注記"
  },
  "C-NEW": {
    CTLLEVEL: "制御レベル",
    OPCODE: "命令および拡張",
    COND: "拡張演算項目 2",
    COMMENT: "注記"
  },
  "P-SPEC": {
    PROCNAME: "名前",
    BEGINEND: "プロシージャーの始め/終わり",
    KEYWORDS: "キーワード",
    COMMENT: "注記"
  }
};

// I/O 仕様書は「レコード識別/フィールド記述」×「プログラム記述/外部記述」で
// 桁の意味が変わるため、4 レイアウトに分割済み（I-SPEC-REC-PGM 等）。
// 桁は記入項目ページとレイアウト図から取っており、layout ページの
// 「N 桁目 (ラベル)」形式では列挙されていないため、この検査の対象外。
// 生成元は docs/origin/generate-rpg-io-definitions.mjs に記録している。
const UNSUPPORTED = {
  "I-SPEC-REC/FLD-PGM/EXT": "4 レイアウトに分割済み（桁は記入項目ページとレイアウト図が正）",
  "O-SPEC-REC/FLD-PGM/EXT": "同上",
  "H-SPEC": "キーワード形式で桁を持たない"
};

const failures = [];
let checked = 0;

for (const [spec, labels] of Object.entries(LABELS)) {
  // C-NEW は C 仕様書の別記法なので、桁の正本は C-SPEC のレイアウト。
  const columns = originColumns(spec === "C-NEW" ? "C" : spec.replace("-SPEC", ""));
  if (!columns) {
    failures.push(`${spec}: 原典のレイアウトが見つからない`);
    continue;
  }

  const definitionPath = join(DEFS, `${spec}.json`);
  const definition = JSON.parse(readFileSync(definitionPath, "utf8"));

  for (const parameter of definition.parameters) {
    const label = labels[parameter.name];
    if (!label) {
      failures.push(`${spec}.${parameter.name}: 原典ラベルの対応が未定義`);
      continue;
    }

    const expected = columns.get(label);
    if (!expected) {
      failures.push(`${spec}.${parameter.name}: 原典に「${label}」が見つからない`);
      continue;
    }

    checked += 1;
    const start = parameter.sourceStart;
    const length = parameter.sourceLength;
    const actual = start && length ? [start, start + length - 1] : null;

    if (!actual || actual[0] !== expected[0] || actual[1] !== expected[1]) {
      failures.push(
        `${spec}.${parameter.name}: 桁が原典と異なる` +
          `（現行 ${actual ? actual.join("-") : "なし"} / 原典 ${expected.join("-")} 「${label}」）`
      );
    }
  }

  // 原典にあるのに定義に無い項目を洗い出す。
  const defined = new Set(definition.parameters.map(p => labels[p.name]).filter(Boolean));
  const missing = Object.values(labels).filter(
    label => columns.has(label) && !defined.has(label)
  );
  if (missing.length > 0) {
    failures.push(`${spec}: 定義に無い項目: ${missing.join(" / ")}`);
  }
}

console.log(`検査した項目: ${checked}`);
for (const [spec, reason] of Object.entries(UNSUPPORTED)) {
  console.log(`  （対象外）${spec}: ${reason}`);
}

if (failures.length > 0) {
  console.error(`\n✗ RPG 桁の原典照合 NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\n✓ RPG 桁の原典照合 OK（原典との差分なし）");
