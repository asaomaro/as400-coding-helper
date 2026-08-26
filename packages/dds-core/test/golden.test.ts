import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../src/dds/parse.js";
import { renderAscii } from "../src/render/ascii.js";

const FIXTURES = join(__dirname, "..", "..", "test", "fixtures");
const GOLDEN = join(__dirname, "..", "..", "test", "golden");

/**
 * 不一致を「何行目の何桁目がどう違うか」で示す。
 *
 * 80×24 の文字列を丸ごと出されても原因が分からない。
 * ゴールデンテストは**落ちたときに原因が分かること**が価値なので、差分の出し方に手をかける。
 */
function assertScreenEqual(actual: string, expected: string): void {
  const a = actual.split("\n");
  const e = expected.split("\n");

  const problems: string[] = [];

  for (let row = 0; row < Math.max(a.length, e.length); row += 1) {
    const actualRow = a[row] ?? "(行なし)";
    const expectedRow = e[row] ?? "(行なし)";
    if (actualRow === expectedRow) {
      continue;
    }

    const col = firstDiffColumn(actualRow, expectedRow);
    problems.push(
      `${row + 1} 行目 ${col + 1} 桁目から違います\n` +
        `  期待: ${JSON.stringify(expectedRow.slice(col, col + 30))}\n` +
        `  実際: ${JSON.stringify(actualRow.slice(col, col + 30))}`
    );
  }

  assert.equal(
    problems.length,
    0,
    `ゴールデンと一致しません（${problems.length} 行）:\n${problems.join("\n")}`
  );
}

function firstDiffColumn(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return limit;
}

describe("実機ゴールデンとの一致（AC5 / AC6）", () => {
  const source = readFileSync(join(FIXTURES, "golden-a.dspf"), "utf8");
  const golden = readFileSync(join(GOLDEN, "golden-a.screen.txt"), "utf8");
  const rendered = renderAscii(parse(source), { record: "GA" });

  test("描画結果が実機のキャプチャと文字単位で一致する", () => {
    assertScreenEqual(rendered, golden);
  });

  test("ゴールデンは 24 行・各行 80 文字である（実機の形式）", () => {
    const rows = golden.split("\n").slice(0, 24);
    assert.equal(rows.length, 24);
    for (const [index, row] of rows.entries()) {
      assert.equal(row.length, 80, `${index + 1} 行目の長さが 80 でない`);
    }
  });
});

describe("ゴールデンが裏付けている個々の事実", () => {
  const golden = readFileSync(join(GOLDEN, "golden-a.screen.txt"), "utf8");
  const rows = golden.split("\n");

  test("SO / SI は空白として現れ、桁を消費する", () => {
    // DDS: '名前' を 5 行 2 桁。SO(2) 名(3-4) 前(5-6) SI(7)
    const row = rows[4];
    assert.equal(row[1], " ", "SO の桁が空白でない");
    assert.equal(row[2], "名");
    assert.equal(row[4], "前");
    assert.equal(row[6], " ", "SI の桁が空白でない");
  });

  test("全角は「文字＋空白」の 2 セルで表される", () => {
    const row = rows[4];
    assert.equal(row[3], " ", "全角の 2 桁目が空白でない");
    assert.equal(row[5], " ", "全角の 2 桁目が空白でない");
  });

  test("フィールド直前の属性バイトは空白として現れる", () => {
    // DDS: FLD2 を 5 行 9 桁。属性バイトは 8 桁目。
    const row = rows[4];
    assert.equal(row[7], " ", "属性バイトの桁が空白でない");
    assert.equal(row[8], "X", "フィールドが 9 桁目から始まっていない");
  });

  test("SBCS 定数の直後にも属性バイトぶんの空きがある", () => {
    // DDS: 'CODE' を 3 行 2 桁（2-5）、FLD1 を 8 桁。6,7 桁目が空き。
    const row = rows[2];
    assert.equal(row.slice(1, 5), "CODE");
    assert.equal(row[5], " ");
    assert.equal(row[6], " ", "属性バイトの桁が空白でない");
    assert.equal(row[7], "X");
  });

  test("DBCS 定数(16 桁)の後ろにフィールドが正しく並ぶ", () => {
    // DDS: '社員マスタ保守' を 7 行 2 桁（SO 2 / 文字 3-16 / SI 17）、FLD3 を 20 桁。
    const row = rows[6];
    assert.equal(row[2], "社");
    assert.equal(row[14], "守");
    assert.equal(row[16], " ", "SI の桁が空白でない");
    assert.equal(row[18], " ", "属性バイトの桁が空白でない");
    assert.equal(row[19], "9", "数値フィールドが 20 桁目から始まっていない");
  });
});

describe("ゴールデンテストに検出力があることの確認", () => {
  const source = readFileSync(join(FIXTURES, "golden-a.dspf"), "utf8");
  const golden = readFileSync(join(GOLDEN, "golden-a.screen.txt"), "utf8");

  test("1 桁ずらすと不一致になる（ずれを見逃さない）", () => {
    // FLD1 を 8 桁目から 9 桁目へ 1 桁だけずらす
    const shifted = source.replace(
      "     A            FLD1           5A  B  3  8",
      "     A            FLD1           5A  B  3  9"
    );
    assert.notEqual(shifted, source, "書き換えが効いていない");

    const rendered = renderAscii(parse(shifted), { record: "GA" });
    assert.notEqual(rendered, golden, "1 桁のずれを検出できていない");
  });

  test("全角定数を 1 桁ずらしても検出する", () => {
    const shifted = source.replace(
      "     A                                  5  2'名前'",
      "     A                                  5  3'名前'"
    );
    const rendered = renderAscii(parse(shifted), { record: "GA" });
    assert.notEqual(rendered, golden, "全角のずれを検出できていない");
  });

  test("定数の 1 文字を変えても検出する", () => {
    const changed = source.replace("'GOLDEN A'", "'GOLDEN B'");
    const rendered = renderAscii(parse(changed), { record: "GA" });
    assert.notEqual(rendered, golden, "文字の違いを検出できていない");
  });
});

describe("実世界の DDS でも描画が壊れない", () => {
  test("実機由来の 86 行 DDS を描画してもグリッドが崩れない", () => {
    const real = readFileSync(join(FIXTURES, "real-gridtst3.dspf"), "utf8");
    const rows = renderAscii(parse(real), { record: "BACKGND" })
      .split("\n")
      .slice(0, 24);
    assert.equal(rows.length, 24);
    for (const [index, row] of rows.entries()) {
      assert.equal(row.length, 80, `${index + 1} 行目が 80 文字でない`);
    }
    // BACKGND は 1〜22 行に定数を敷き詰めた様式
    assert.ok(rows[0].includes("BG01"));
    assert.ok(rows[21].includes("BG22"));
  });
});
