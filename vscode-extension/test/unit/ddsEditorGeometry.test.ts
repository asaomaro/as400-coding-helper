import { strict as assert } from "node:assert";
import {
  cellFromOffset,
  movedTo,
  resizedTo
} from "../../src/dds/webview/geometry";

const METRICS = { cellW: 8, cellH: 18 };
const CANVAS = { rows: 24, cols: 80 };

suite("セル座標とピクセルの変換（UI が持つ唯一の計算）", () => {
  test("キャンバス左上は 1 行 1 桁", () => {
    assert.deepEqual(cellFromOffset(0, 0, METRICS, CANVAS), { line: 1, pos: 1 });
  });

  test("セルの内側はどこを指しても同じセル", () => {
    assert.deepEqual(cellFromOffset(7.9, 17.9, METRICS, CANVAS), {
      line: 1,
      pos: 1
    });
    assert.deepEqual(cellFromOffset(8, 18, METRICS, CANVAS), {
      line: 2,
      pos: 2
    });
  });

  test("キャンバスの外を指しても範囲内に収まる", () => {
    assert.deepEqual(cellFromOffset(10_000, 10_000, METRICS, CANVAS), {
      line: 24,
      pos: 80
    });
    assert.deepEqual(cellFromOffset(-50, -50, METRICS, CANVAS), {
      line: 1,
      pos: 1
    });
  });
});

suite("ドラッグ移動の丸め", () => {
  const origin = { line: 5, pos: 10 };

  test("半セル未満は動かない（クリックで位置が変わらない）", () => {
    assert.deepEqual(movedTo(origin, 3, 8, 5, METRICS, CANVAS), origin);
  });

  test("半セルを超えると 1 桁動く", () => {
    assert.deepEqual(movedTo(origin, 5, 0, 5, METRICS, CANVAS), {
      line: 5,
      pos: 11
    });
    assert.deepEqual(movedTo(origin, -5, 0, 5, METRICS, CANVAS), {
      line: 5,
      pos: 9
    });
  });

  test("右端はアイテムの幅ぶんを残して止まる", () => {
    // 幅 10 のアイテムは 71 桁目までしか置けない（71..80）。
    assert.deepEqual(movedTo(origin, 10_000, 0, 10, METRICS, CANVAS).pos, 71);
  });

  test("上下端でも範囲を出ない", () => {
    assert.equal(movedTo(origin, 0, -10_000, 5, METRICS, CANVAS).line, 1);
    assert.equal(movedTo(origin, 0, 10_000, 5, METRICS, CANVAS).line, 24);
  });
});

suite("リサイズの丸め", () => {
  test("引き伸ばすと桁数が増える", () => {
    assert.equal(resizedTo(5, 10, 16, METRICS, CANVAS), 7);
  });

  test("1 桁未満にはならない", () => {
    assert.equal(resizedTo(5, 10, -10_000, METRICS, CANVAS), 1);
  });

  test("画面の右端を超えない", () => {
    assert.equal(resizedTo(5, 70, 10_000, METRICS, CANVAS), 11);
  });
});
