import * as assert from "assert";
import {
  buildDspfRenderModel,
  constantSegments,
  printWidth,
  segmentsWidth
} from "../../src/core/dds/dspfRenderModel";

/**
 * 描画モデル。**守るのは「区切りの合計＝表示桁数」**。
 *
 * ここがずれると、DBCS を含む画面で 1 桁ずれた絵になる（SO/SI が桁を消費するため）。
 * UI は区切りを `cols × セル幅` の箱に流すだけなので、**桁の正しさはこの層で決まる**。
 */

const SOURCE = [
  "     A                                      DSPSIZ(24 80 *DS3)",
  "     A          R TEST",
  "     A                                  1  2'顧客一覧表'",
  "     A            NUMFLD         5S 0B  3 20",
  "     A            TXTFLD        10A  O  5 20",
  "     A            REFFLD    R        B  7 20"
];

suite("描画モデル: 区切りは表示桁数と一致する", () => {
  test("ASCII だけの定数", () => {
    const segments = constantSegments("ABC");
    assert.strictEqual(segmentsWidth(segments), printWidth("ABC"));
    assert.deepStrictEqual(segments, [{ text: "ABC", cols: 3 }]);
  });

  test("全角だけの定数は SO / SI が 1 桁ずつ挟まる", () => {
    const segments = constantSegments("顧客");
    assert.strictEqual(segmentsWidth(segments), printWidth("顧客"));
    assert.deepStrictEqual(segments, [
      { text: "", cols: 1 },
      { text: "顧客", cols: 4 },
      { text: "", cols: 1 }
    ]);
  });

  test("半角と全角が混ざると種別ごとに区切られる", () => {
    const text = "ID:顧客";
    const segments = constantSegments(text);
    assert.strictEqual(segmentsWidth(segments), printWidth(text));
    assert.deepStrictEqual(segments, [
      { text: "ID:", cols: 3 },
      { text: "", cols: 1 },
      { text: "顧客", cols: 4 },
      { text: "", cols: 1 }
    ]);
  });

  test("全角が途切れるたびに SO / SI が要る", () => {
    const text = "あZい";
    assert.strictEqual(segmentsWidth(constantSegments(text)), printWidth(text));
  });
});

suite("描画モデル: 項目の翻訳", () => {
  const model = buildDspfRenderModel(SOURCE);
  const find = (line: number) => model.items.find(item => item.sourceLine === line);

  test("画面の大きさと様式を持つ", () => {
    assert.deepStrictEqual(model.canvas, { rows: 24, columns: 80 });
    assert.deepStrictEqual(model.records, ["TEST"]);
  });

  test("定数はリテラルを描き、幅は SO/SI 込み", () => {
    const constant = find(3);
    assert.ok(constant);
    assert.strictEqual(constant.kind, "constant");
    assert.strictEqual(constant.label, "顧客一覧表");
    assert.strictEqual(constant.widthCols, printWidth("顧客一覧表"));
    assert.strictEqual(segmentsWidth(constant.segments), constant.widthCols);
  });

  test("数値フィールドは 9、英数字は X のプレースホルダ", () => {
    assert.strictEqual(find(4)?.segments[0]?.text, "99999");
    assert.strictEqual(find(5)?.segments[0]?.text, "XXXXXXXXXX");
  });

  test("**定数は長さを変えられない**（桁数欄を持たないため）", () => {
    assert.strictEqual(find(3)?.resizable, false);
    assert.strictEqual(find(4)?.resizable, true);
  });

  test("幅が分からない項目は区切りを持たない（描かずに知らせる）", () => {
    const reference = find(6);
    assert.ok(reference);
    assert.strictEqual(reference.widthCols, undefined);
    assert.deepStrictEqual(reference.segments, []);
    assert.strictEqual(reference.resizable, false, "幅不明の項目は長さを変えられない");
  });

  test("編集の宛先はソース行（合成 ID を持たない）", () => {
    for (const item of model.items) {
      assert.ok(Number.isInteger(item.sourceLine) && item.sourceLine > 0);
    }
  });

  test("属性文字の占有を持つ（隣接違反を見せるため）", () => {
    const field = find(5);
    assert.ok(field);
    assert.strictEqual(field.occupancy.start, field.column - 1);
    assert.strictEqual(field.occupancy.end, field.column + (field.widthCols ?? 0));
  });
});
