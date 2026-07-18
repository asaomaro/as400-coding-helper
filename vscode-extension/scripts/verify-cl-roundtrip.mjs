#!/usr/bin/env node
// CL コマンドの「往復」検証ツール。
//
// F4 プロンプターは、ソース上のコマンドを読み込んで入力欄に展開し、確定すると
// ソースへ書き戻す。このとき「開く → 確定 → 再度開く → 確定」で結果が変わっては
// ならない（値が失われたり、書式が振動したりしてはならない）。
//
// 実際に、解析側が CALL 専用のハードコードだったため CALL 以外の全コマンドで
// パラメータが消失していた事故がある。往復の安定性は目視で気づけないため、
// ここで機械的に担保する。
//
// 検証内容:
//   1. 原典の使用例を解析 → 生成 → 再解析したとき、入力値が一致すること
//   2. 生成を2回繰り返しても出力テキストが変わらないこと（べき等）
//   3. 元の例にあったパラメータが出力から消えていないこと
//   4. 代表的な記述パターン（複数行継続・ラベル・コメント・引用符・入れ子・
//      繰り返し・折り返し）が往復で一致すること
//
// 前提: `npm run compile` 済み（out/ を読む）
// 使い方:  node scripts/verify-cl-roundtrip.mjs
// 終了コード: 0=全件OK / 1=1件以上の不一致

import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Module from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const require = createRequire(import.meta.url);

// out/ のモジュールは vscode を import するが、往復に関わる処理は
// vscode API を使わない純粋関数。テスト実行用に最小限のスタブを挿す。
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "vscode") {
    return {
      window: {},
      workspace: {},
      Range: class {},
      Position: class {},
      WorkspaceEdit: class {}
    };
  }
  return originalLoad.call(this, request, ...rest);
};

const OUT = join(root, "out/prompter");
const { buildClCommandText } = require(join(OUT, "applyChanges"));
const {
  parseClCommand,
  mapParsedCommandToValues,
  joinContinuationLines,
  extractComments
} = require(join(OUT, "clCommandParser"));

const langArg = process.argv.find(a => a.startsWith("--lang="));
const LANG = langArg ? langArg.slice("--lang=".length) : "ja";
const DEF_DIR = join(root, `resources/prompter/cl/${LANG}`);
const loadDefinition = command =>
  JSON.parse(readFileSync(join(DEF_DIR, `${command}.json`), "utf8"));

const flatten = text => text.split("\n").map(line => line.trim()).join(" ");
const sortedEntries = values => JSON.stringify(Object.entries(values).sort());

/** ソース行 → 入力値 → コマンドテキスト の1周。 */
function cycle(definition, lines) {
  const joined = joinContinuationLines(lines);
  const parsed = parseClCommand(joined);
  const values = parsed ? mapParsedCommandToValues(definition, parsed) : {};
  const text = buildClCommandText(definition, values, {
    label: parsed?.label,
    comments: extractComments(lines)
  });
  return { values, text };
}

const failures = [];
const fail = (label, detail) => failures.push(`${label}: ${detail}`);

// ---------------------------------------------------------------- 全定義の往復

const commands = readdirSync(DEF_DIR)
  .filter(name => name.endsWith(".json"))
  .map(name => name.slice(0, -5));

let checked = 0;
let noExample = 0;

for (const command of commands) {
  const definition = loadDefinition(command);
  const example = definition.examples?.[0];
  if (!example) {
    noExample += 1;
    continue;
  }

  checked += 1;
  const source = [" ".repeat(13) + example.code];

  const first = cycle(definition, source);
  const second = cycle(definition, first.text.split("\n"));
  const third = cycle(definition, second.text.split("\n"));

  if (sortedEntries(first.values) !== sortedEntries(second.values)) {
    fail(command, `往復で入力値が変化した\n      1回目: ${JSON.stringify(first.values)}\n      2回目: ${JSON.stringify(second.values)}`);
  }

  if (second.text !== third.text) {
    fail(command, `生成がべき等でない\n      1回目: ${flatten(second.text)}\n      2回目: ${flatten(third.text)}`);
  }

  // 元の例にあったキーワードが出力から消えていないこと。
  const keywordsOf = text => {
    const parsed = parseClCommand(joinContinuationLines(text.split("\n")));
    return parsed ? Object.keys(parsed.parameters).sort() : [];
  };
  const before = keywordsOf(example.code);
  const after = keywordsOf(first.text);
  const lost = before.filter(name => !after.includes(name));
  if (lost.length > 0) {
    fail(command, `パラメータが消失した: ${lost.join(", ")}\n      原典: ${example.code}\n      生成: ${flatten(first.text)}`);
  }
}

// ------------------------------------------------------- 代表的な記述パターン

const PATTERNS = [
  {
    label: "複数行（継続 +）",
    command: "CHGJOB",
    lines: [
      "             CHGJOB     JOB(*) LOG(4 00 *SECLVL) +",
      "                          OUTQ(QGPL/MYOUTQ) RUNPTY(50)"
    ],
    // 継続行が正しく連結されないと、境界のパラメータが1トークンに潰れる。
    // 出力テキストへの部分一致では潰れた形にも一致してしまうため、
    // 解析後の値そのものを検査する。
    expect: (_text, values) =>
      (values.LEVEL === "4" && values.OUTQ === "MYOUTQ" && values.RUNPTY === "50") ||
      `継続行をまたぐパラメータが失われた（LEVEL=${values.LEVEL} OUTQ=${values.OUTQ}）`
  },
  {
    // 継続文字の直前に空白が無く、かつ次行が字下げされていない形。
    // `+` は「空白1個を補って連結する」ため、補わない実装だと前後の
    // パラメータが1トークンに潰れて後ろ側が失われる。
    // （字下げがあると空白が偶然の区切りになり、欠陥が隠れてしまう）
    label: "複数行（継続 + / 空白の補いが必要な形）",
    command: "CHGJOB",
    lines: [
      "             CHGJOB     JOB(*) LOG(4 00 *SECLVL)+",
      "OUTQ(QGPL/MYOUTQ) RUNPTY(50)"
    ],
    expect: (_text, values) =>
      (values.LEVEL === "4" && values.OUTQ === "MYOUTQ" && values.RUNPTY === "50") ||
      `継続行をまたぐパラメータが失われた（LEVEL=${values.LEVEL} OUTQ=${values.OUTQ}）`
  },
  {
    // 修飾名の総称指定には `/*` が現れる。コメント開始と誤認すると
    // コマンドが途中で切れる（実機が「A matching parenthesis not found.」で
    // 弾いて発覚した）。実機で OBJ(MYLIB/*ALL) が受理されることを確認済み。
    label: "修飾名の総称指定（/* を含む）",
    command: "DLTOBJ",
    lines: ["             DLTOBJ     OBJ(MYLIB/*ALL) OBJTYPE(*USRSPC)"],
    expect: (_text, values) =>
      (values.LIB === "MYLIB" && values.OBJ === "*ALL" && values.OBJTYPE === "*USRSPC") ||
      `総称指定が壊れた（LIB=${values.LIB} OBJ=${values.OBJ}）`
  },
  {
    label: "ラベル付き",
    command: "ADDLIBLE",
    lines: ["TAG1:        ADDLIBLE   LIB(TESTLIB) POSITION(*AFTER QGPL)"],
    expect: text => /TAG1:/.test(text) || "ラベルが失われた"
  },
  {
    label: "行内コメント",
    command: "ADDLIBLE",
    lines: ["             ADDLIBLE   LIB(TESTLIB) /* 追加 */ POSITION(*LAST)"],
    expect: text => /\/\* 追加 \*\//.test(text) || "コメントが失われた"
  },
  {
    label: "引用符内の括弧と継続文字",
    command: "SNDMSG",
    lines: ["             SNDMSG     MSG('A(1) + B(2)') TOUSR(QSYSOPR)"],
    expect: text => /'A\(1\) \+ B\(2\)'/.test(text) || "引用符内が壊れた"
  },
  {
    label: "入れ子・二重括弧",
    command: "ALCOBJ",
    lines: ["             ALCOBJ     OBJ((LIBB/FILEA *FILE *EXCL MEMBERA)) WAIT(60)"],
    expect: (_text, values) =>
      (values.LIB === "LIBB" && values.OBJ === "FILEA" && values.MBR === "MEMBERA") ||
      "入れ子の要素が壊れた"
  },
  {
    label: "繰り返し指定（2件）",
    command: "ALCOBJ",
    lines: [
      "             ALCOBJ     OBJ((LIBB/FILEA *FILE *EXCL MEMBERA) +",
      "                          (LIBC/FILEB *FILE *SHRRD)) WAIT(60)"
    ],
    expect: (_text, values) =>
      (values["LIB#2"] === "LIBC" && values["OBJ#2"] === "FILEB") ||
      "2件目の繰り返しが失われた"
  },
  {
    label: "修飾名の省略",
    command: "CALL",
    lines: ["             CALL       PGM(MYPGM)"],
    // ライブラリーを省略した形は、オブジェクト側の欄に入らなければならない
    // （右詰め）。ライブラリー欄に入っても出力テキストは同じになるため、
    // テキストではなくどの欄に入ったかを検査する。
    expect: (text, values) =>
      (values.PGM === "MYPGM" && !values.LIB && /PGM\(MYPGM\)/.test(text)) ||
      `修飾名の省略形が誤った欄に入った（PGM=${values.PGM} LIB=${values.LIB}）`
  },
  {
    label: "要素の途中省略 *N",
    command: "ADDLIBLE",
    lines: ["             ADDLIBLE   LIB(TESTLIB) POSITION(*N QGPL)"],
    expect: text => /POSITION\(\*N QGPL\)/.test(text) || "*N の省略が壊れた"
  },
  {
    label: "折り返しが起きる長さ",
    command: "CRTPRTF",
    lines: [
      "             CRTPRTF    FILE(QGPL/DSPHIST) SRCFILE(PRSNNL/JOBHIST) SRCMBR(HIST) TEXT('印刷') PAGESIZE(66 132)"
    ],
    expect: text =>
      text.split("\n").every(line => line.length <= 72) || "桁幅を超えた行がある"
  }
];

for (const pattern of PATTERNS) {
  const definition = loadDefinition(pattern.command);
  const first = cycle(definition, pattern.lines);
  const second = cycle(definition, first.text.split("\n"));

  if (sortedEntries(first.values) !== sortedEntries(second.values)) {
    fail(pattern.label, `往復で入力値が変化した\n      1回目: ${JSON.stringify(first.values)}\n      2回目: ${JSON.stringify(second.values)}`);
    continue;
  }

  if (first.text !== second.text) {
    fail(pattern.label, `生成がべき等でない\n      1回目: ${flatten(first.text)}\n      2回目: ${flatten(second.text)}`);
    continue;
  }

  const verdict = pattern.expect?.(first.text, first.values);
  if (typeof verdict === "string") {
    fail(pattern.label, `${verdict}\n      生成: ${flatten(first.text)}`);
  }
}

// ------------------------------------------------------------------------ 結果

if (failures.length > 0) {
  console.error(`✗ CL 往復検証 NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `✓ CL 往復検証 OK（定義 ${checked} 件 / 記述パターン ${PATTERNS.length} 件）` +
    `${noExample > 0 ? ` ※原典に使用例が無い ${noExample} 件は対象外` : ""}`
);
