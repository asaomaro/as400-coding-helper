import * as assert from "assert";
import { cellFromOffset, movedTo, resizedTo } from "../../src/dds/webview/geometry";

/**
 * UI が持つ唯一の計算。**文字に依存する計算は 1 つも無い**（それは core の仕事）。
 */

const METRICS = { cellWidth: 8, lineHeight: 16 };
const CANVAS = { rows: 24, columns: 80 };

suite("セル座標とピクセルの変換", () => {
  test("左上は 1 行 1 桁", () => {
    assert.deepStrictEqual(cellFromOffset(0, 0, METRICS, CANVAS), { row: 1, column: 1 });
  });

  test("セルの内側はどこを指しても同じセル", () => {
    assert.deepStrictEqual(cellFromOffset(7.9, 15.9, METRICS, CANVAS), { row: 1, column: 1 });
    assert.deepStrictEqual(cellFromOffset(8, 16, METRICS, CANVAS), { row: 2, column: 2 });
  });

  test("キャンバスの外を指しても範囲内に収まる", () => {
    assert.deepStrictEqual(cellFromOffset(9999, 9999, METRICS, CANVAS), { row: 24, column: 80 });
    assert.deepStrictEqual(cellFromOffset(-50, -50, METRICS, CANVAS), { row: 1, column: 1 });
  });
});

suite("ドラッグ移動の丸め", () => {
  const origin = { row: 5, column: 10 };

  test("半セル未満は動かない（クリックで位置が変わらない）", () => {
    assert.deepStrictEqual(movedTo(origin, 3, 7, 5, METRICS, CANVAS), origin);
  });

  test("半セルを超えると 1 桁動く", () => {
    assert.deepStrictEqual(movedTo(origin, 5, 0, 5, METRICS, CANVAS), { row: 5, column: 11 });
    assert.deepStrictEqual(movedTo(origin, -5, 0, 5, METRICS, CANVAS), { row: 5, column: 9 });
  });

  test("右端は項目の幅ぶん余白を残して止まる", () => {
    assert.strictEqual(movedTo(origin, 9999, 0, 10, METRICS, CANVAS).column, 71);
  });

  test("上下端でも範囲を出ない", () => {
    assert.strictEqual(movedTo(origin, 0, -9999, 5, METRICS, CANVAS).row, 1);
    assert.strictEqual(movedTo(origin, 0, 9999, 5, METRICS, CANVAS).row, 24);
  });
});

suite("つまみの丸め", () => {
  test("引くと桁数が増える", () => {
    assert.strictEqual(resizedTo(5, 10, 16, METRICS, CANVAS), 7);
  });

  test("1 桁未満にはならない", () => {
    assert.strictEqual(resizedTo(5, 10, -9999, METRICS, CANVAS), 1);
  });

  test("画面の右端を超えない", () => {
    assert.strictEqual(resizedTo(5, 70, 9999, METRICS, CANVAS), 11);
  });
});
