import * as assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import { applyDdsEdits, validateDdsEdits } from "../../src/core/dds/ddsEdit";
import { buildPrtfRenderModel } from "../../src/core/dds/prtfRenderModel";

/**
 * 帳票（PRTF）の描画モデル。
 *
 * ## 画面と何が違うか
 *
 * - **行が行送りで決まる。** 実務の PRTF は位置欄に行番号を書かず、
 *   `SPACEA` / `SPACEB` / `SKIPA` / `SKIPB` で行が動く。
 * - **属性文字が無い。** 表示装置は項目の前後 1 桁を属性文字が占めるが、印刷には出ない。
 * - **紙面の大きさが DDS に無い。** `CRTPRTF` の `PAGESIZE` で決まる。
 *
 * ここで守るのは「**行送りで決まった行に描かれる**」ことと、
 * 「**行番号を書き込まない**」こと（書き込むと行送りが無効になる）。
 */

const put = (line: string, column: number, value: string): string => {
  const a = line.split("");
  for (let i = 0; i < value.length; i += 1) a[column - 1 + i] = value[i];
  return a.join("");
};
const A = () => put(" ".repeat(80), 6, "A");
const rec = (name: string, keywords = "") =>
  put(put(put(A(), 17, "R"), 19, name), 45, keywords).replace(/ +$/u, "");
const kwd = (keywords: string) => put(A(), 45, keywords).replace(/ +$/u, "");
/** 桁だけを書いた定数（帳票の普通の書き方）。 */
const constantAt = (column: number, text: string) =>
  put(put(A(), 42, String(column).padStart(3)), 45, `'${text}'`).replace(/ +$/u, "");
/** 行番号も書いた定数。 */
const constantRowCol = (row: number, column: number, text: string) =>
  put(put(put(A(), 39, String(row).padStart(3)), 42, String(column).padStart(3)), 45, `'${text}'`)
    .replace(/ +$/u, "");

const SOURCE = [
  rec("HEADING", "SKIPB(1)"),
  kwd("SPACEA(2)"),
  constantAt(30, "TITLE"),
  rec("DETLINE", "SPACEA(1)"),
  constantAt(5, "AB"),
  constantRowCol(20, 10, "FIXED")
];

suite("帳票の描画モデル", () => {
  const model = buildPrtfRenderModel(SOURCE);
  const at = (sourceLine: number) => model.items.find(item => item.sourceLine === sourceLine);

  test("種別は prtf、紙面は CRTPRTF の既定（66 × 132）", () => {
    assert.strictEqual(model.kind, "prtf");
    assert.deepStrictEqual(model.canvas, { rows: 66, columns: 132 });
    assert.strictEqual(model.overflowLine, 60);
  });

  test("紙面の大きさは渡された値を使う（DDS に書かれていないので）", () => {
    const narrow = buildPrtfRenderModel(SOURCE, { page: { rows: 60, columns: 80, overflowLine: 55 } });
    assert.deepStrictEqual(narrow.canvas, { rows: 60, columns: 80 });
    assert.strictEqual(narrow.overflowLine, 55);
  });

  test("**行送りで決まった行に描かれる**（SKIPB / SPACEA）", () => {
    // SKIPB(1) で 1 行目、SPACEA(2) で次の様式は 3 行目から。
    assert.strictEqual(at(3)?.row, 1);
    assert.strictEqual(at(5)?.row, 3);
  });

  test("行番号を書いた項目はその行に出る", () => {
    assert.strictEqual(at(6)?.row, 20);
  });

  test("**行番号を書いていない項目に印が付く**", () => {
    assert.strictEqual(at(3)?.rowFromSpacing, true);
    assert.strictEqual(at(5)?.rowFromSpacing, true);
    assert.strictEqual(at(6)?.rowFromSpacing, undefined, "行番号を書いた項目には付かない");
  });

  test("**占有に属性文字を含めない**（印刷に属性バイトは出ない）", () => {
    const item = at(5);
    assert.ok(item);
    // 表示装置なら column-1 から始まるが、帳票は項目そのもの。
    assert.strictEqual(item.occupancy.start, item.column);
    assert.strictEqual(item.occupancy.end, item.column + (item.widthCols ?? 0));
  });

  test("一覧が「位置なし」にならない（行送りで位置は決まっている）", () => {
    const listed = model.outline.flatMap(record => record.items);
    for (const item of listed) {
      assert.strictEqual(item.hidden, undefined, `${item.label} が隠れている`);
      assert.ok(item.row !== undefined && item.column !== undefined, item.label);
    }
  });

  test("キーワードとプロパティが載る", () => {
    const listed = model.outline.flatMap(record => record.items).find(i => i.sourceLine === 3);
    assert.strictEqual(listed?.attributes.text, "TITLE");
  });
});

suite("帳票の描画モデル: 実サンプル", () => {
  const ROOT = join(__dirname, "..", "..", "..", "..");
  const lines = readFileSync(join(ROOT, "docs", "src", "CUSTRPT.prtf"), "utf8").split(/\r?\n/u);
  const model = buildPrtfRenderModel(lines);

  test("項目が紙面に置かれる", () => {
    assert.strictEqual(model.items.length, 4);
    assert.deepStrictEqual(
      model.items.map(item => [item.row, item.column]),
      [[1, 30], [3, 5], [3, 15], [3, 50]]
    );
  });

  test("**実サンプルは全項目が行送りで決まる**（実務の書き方）", () => {
    assert.ok(model.items.every(item => item.rowFromSpacing === true));
  });

  test("様式が並ぶ", () => {
    assert.deepStrictEqual(model.records, ["HEADING", "DETLINE"]);
  });
});

suite("帳票の編集: 行送りで決まる行は書き換えない", () => {
  test("**行を変える移動は拒否する**", () => {
    const rejections = validateDdsEdits(SOURCE, [
      { kind: "move", sourceLine: 5, row: 8, column: 5 }
    ], "DDS-PRTF");
    assert.deepStrictEqual(rejections.map(r => r.code), ["row-from-spacing"]);
  });

  test("行番号を書いた項目の移動は通る", () => {
    assert.deepStrictEqual(
      validateDdsEdits(SOURCE, [{ kind: "move", sourceLine: 6, row: 8, column: 10 }], "DDS-PRTF"),
      []
    );
  });

  test("**桁だけの移動は通り、行欄には触らない**", () => {
    assert.deepStrictEqual(
      validateDdsEdits(SOURCE, [{ kind: "moveColumn", sourceLine: 5, column: 9 }], "DDS-PRTF"),
      []
    );
    const results = applyDdsEdits(SOURCE, [{ kind: "moveColumn", sourceLine: 5, column: 9 }], "DDS-PRTF");
    assert.strictEqual(results.length, 1);
    const line = results[0].lines[0];
    assert.strictEqual(line.slice(38, 41).trim(), "", "行欄に書き込んでいる");
    assert.strictEqual(line.slice(41, 44), "  9");
  });

  test("桁が桁欄に収まらなければ拒否する", () => {
    assert.deepStrictEqual(
      validateDdsEdits(SOURCE, [{ kind: "moveColumn", sourceLine: 5, column: 1000 }], "DDS-PRTF").map(r => r.code),
      ["position-out-of-range"]
    );
  });
});
