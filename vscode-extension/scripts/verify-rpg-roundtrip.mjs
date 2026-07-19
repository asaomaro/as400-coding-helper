#!/usr/bin/env node
// RPG 固定長仕様書の「往復」検証ツール。
//
// F4 プロンプターは、ソース行を桁位置で読み取って入力欄に展開し、確定すると
// 同じ桁位置へ書き戻す。このとき「何も編集せずに確定した」場合は、行が
// 1文字たりとも変わってはならない。
//
// 実際に、取り出し時に前後の空白を落として書き戻し時に詰め直していたため、
// 編集していない項目まで桁がずれて行が変形していた（F仕様書の外部記述 'E' が
// 1桁右へ動くなど）。固定長では桁ズレがそのまま構文の破壊になる。
//
// 前提: `npm run compile` 済み（out/ を読む）
// 使い方:  node scripts/verify-rpg-roundtrip.mjs
// 終了コード: 0=全件OK / 1=1件以上の不一致

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Module from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const require = createRequire(import.meta.url);

// 往復に関わる処理は vscode API を使わない。最小限のスタブを挿す。
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "vscode") {
    class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    }
    class Range {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    }
    return { window: {}, workspace: {}, Range, Position, WorkspaceEdit: class {} };
  }
  return originalLoad.call(this, request, ...rest);
};

const OUT = join(root, "out/prompter");
const { buildRpgLineText } = require(join(OUT, "applyChanges"));
const { extractInitialValues } = require(join(OUT, "initialValues"));

const DEF_DIR = join(root, "resources/prompter/rpg");
// 定義は方言と言語で分かれている（rpg/{dialect}/{lang}/）。往復は言語に依らないので
// 日本語版で確かめる。英語版は表示に出る文字だけが違い、桁も欄の名前も同じ。
const loadDefinition = rel => {
  const [dialect, ...rest] = rel.split("/");
  return JSON.parse(
    readFileSync(join(DEF_DIR, dialect, "ja", `${rest.join("/")}.json`), "utf8")
  );
};

const fakeDocument = lines => ({
  lineCount: lines.length,
  lineAt: index => ({ text: lines[index] }),
  getText: range => lines.slice(range.start.line, range.end.line + 1).join("\n"),
  uri: { toString: () => "verify-rpg-roundtrip" }
});

const valuesOf = (definition, line) =>
  extractInitialValues(
    {
      document: fakeDocument([line]),
      line: 0,
      column: 0,
      language: "rpg-fixed",
      keyword: definition.keyword
    },
    definition
  );

const sortedEntries = values => JSON.stringify(Object.entries(values).sort());

// 実際のソースに現れる書き方。桁の寄せ方が一様でないものを意図的に含める。
const SAMPLES = [
  ["ile/D-SPEC", "     D CUSTNAME        S             20A   INZ('ABC')"],
  ["ile/D-SPEC", "     D TOTAL           S              7P 2 INZ(0)"],
  ["ile/C-SPEC", "     C     KEY           CHAIN     CUSTFILE"],
  ["ile/C-SPEC", "     C                   MOVEL     NAME          OUTNAME"],
  // 外部記述の 'E' は数値扱いの桁に入るため、詰め直すと右へずれる。
  ["ile/F-SPEC", "     FCUSTFILE  IF   E           K DISK"],
  // I/O 仕様書は「レコード識別/フィールド記述」×「プログラム記述/外部記述」で
  // 桁の意味が変わるため、レイアウトごとに検証する。
  ["ile/I-SPEC-REC-PGM", "     ICUSTFILE  NS  01   1 C5"],
  ["ile/I-SPEC-FLD-PGM", "     I                                  1   10 CUSTNO"],
  ["ile/I-SPEC-REC-EXT", "     ICUSTREC   01"],
  ["ile/O-SPEC-REC-PGM", "     OCUSTLIST  H    1P"],
  ["ile/O-SPEC-FLD-PGM", "     O                       CUSTNO        10"]
];

const failures = [];

for (const [definitionPath, line] of SAMPLES) {
  const definition = loadDefinition(definitionPath);

  const first = valuesOf(definition, line);
  const rebuilt = buildRpgLineText(line, definition, first);

  // 1. 何も編集していないなら、行は変わってはならない。
  //    （末尾の空白の増減だけは許容する）
  if (rebuilt.trimEnd() !== line.trimEnd()) {
    failures.push(
      `${definitionPath}: 編集していないのに行が変形した\n` +
        `      元  : ${JSON.stringify(line)}\n` +
        `      出力: ${JSON.stringify(rebuilt)}`
    );
    continue;
  }

  // 2. 再度読み取っても同じ値になること。
  const second = valuesOf(definition, rebuilt);
  if (sortedEntries(first) !== sortedEntries(second)) {
    failures.push(
      `${definitionPath}: 往復で入力値が変化した\n` +
        `      1回目: ${JSON.stringify(first)}\n` +
        `      2回目: ${JSON.stringify(second)}`
    );
    continue;
  }

  // 3. 値を変更したときは、その桁だけが変わること。
  const target = definition.parameters.find(
    parameter =>
      typeof parameter.sourceStart === "number" &&
      parameter.inputType === "text" &&
      first[parameter.name]
  );
  if (target) {
    const edited = { ...first, [target.name]: "ZZZ" };
    const editedLine = buildRpgLineText(line, definition, edited);
    const readBack = valuesOf(definition, editedLine);

    if (readBack[target.name] !== "ZZZ") {
      failures.push(
        `${definitionPath}: 編集した ${target.name} が書き戻せていない\n` +
          `      出力: ${JSON.stringify(editedLine)}\n` +
          `      再読: ${JSON.stringify(readBack[target.name])}`
      );
      continue;
    }

    const untouched = Object.keys(first).filter(
      name => name !== target.name && first[name] !== readBack[name]
    );
    if (untouched.length > 0) {
      failures.push(
        `${definitionPath}: ${target.name} の編集で他の項目が変化した: ${untouched.join(", ")}\n` +
          `      元  : ${JSON.stringify(line)}\n` +
          `      出力: ${JSON.stringify(editedLine)}`
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`✗ RPG 往復検証 NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ RPG 往復検証 OK（${SAMPLES.length} 行）`);
