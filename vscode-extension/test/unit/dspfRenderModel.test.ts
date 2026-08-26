import * as assert from "assert";
import {
  applyIndicators,
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
      { text: "", cols: 1, shift: "so" },
      { text: "顧客", cols: 4 },
      { text: "", cols: 1, shift: "si" }
    ]);
  });

  test("半角と全角が混ざると種別ごとに区切られる", () => {
    const text = "ID:顧客";
    const segments = constantSegments(text);
    assert.strictEqual(segmentsWidth(segments), printWidth(text));
    assert.deepStrictEqual(segments, [
      { text: "ID:", cols: 3 },
      { text: "", cols: 1, shift: "so" },
      { text: "顧客", cols: 4 },
      { text: "", cols: 1, shift: "si" }
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

suite("描画モデル: SO / SI の種別", () => {
  test("全角の前後が so / si になる", () => {
    assert.deepStrictEqual(constantSegments("顧客"), [
      { text: "", cols: 1, shift: "so" },
      { text: "顧客", cols: 4 },
      { text: "", cols: 1, shift: "si" }
    ]);
  });

  test("半角だけなら種別は付かない", () => {
    assert.deepStrictEqual(constantSegments("ABC"), [{ text: "ABC", cols: 3 }]);
  });

  test("全角が途切れるたびに so / si が要る", () => {
    const segments = constantSegments("あZい");
    assert.deepStrictEqual(
      segments.map(segment => segment.shift ?? "-"),
      ["so", "-", "si", "-", "so", "-", "si"]
    );
  });

  test("**種別を足しても幅は変わらない**（表示の有無で桁が動かない前提）", () => {
    for (const text of ["ABC", "顧客", "あZい", "ID:顧客番号", ""]) {
      assert.strictEqual(
        segmentsWidth(constantSegments(text)),
        printWidth(text),
        `${text} の幅が変わった`
      );
    }
  });

  test("so / si の区切りは 1 桁で、文字を持たない", () => {
    for (const segment of constantSegments("顧客A")) {
      if (segment.shift === undefined) continue;
      assert.strictEqual(segment.cols, 1);
      assert.strictEqual(segment.text, "");
    }
  });
});

/**
 * 標識の状態の反映。**守るのは「指定しなければ何も変わらない」**。
 *
 * 状態は利用者が指定する表示の状態で、ソースには書かれていない。既定（何も指定しない）で
 * モデルが 1 ビットでも変われば、既存の描画・診断・一覧のすべてが疑わしくなる。
 */
const CONDITIONED = [
  "     A          R TEST",
  "     A  50                              3  2'部門名'",
  "     A N50                              3  2'未設定'",
  "     A  01        FLD1          10A  O  5  2",
  "     A  02        FLD2          10A  O  5  6",
  "     A            BASE1          5A  O  7  2",
  "     A            BASE2          5A  O  7  4",
  "     A  60        NOPOS          5A  O"
];

suite("描画モデル: 標識の状態を反映する", () => {
  const model = buildDspfRenderModel(CONDITIONED);
  const drawn = (states: Parameters<typeof applyIndicators>[1]) =>
    applyIndicators(model, states).items.map(item => item.sourceLine);
  const outlineItem = (states: Parameters<typeof applyIndicators>[1], sourceLine: number) =>
    applyIndicators(model, states)
      .outline.flatMap(record => record.items)
      .find(item => item.sourceLine === sourceLine);

  test("状態が空なら引数のモデルをそのまま返す（同一参照）", () => {
    // 参照で比べる。既定の見え方が変わらないことを、値の比較ではなく構造で固定する。
    assert.strictEqual(applyIndicators(model, {}), model);
  });

  test("ソース中の標識を番号順に持つ", () => {
    assert.deepStrictEqual(model.indicators, [
      { indicator: "01", uses: 1 },
      { indicator: "02", uses: 1 },
      { indicator: "50", uses: 2 },
      { indicator: "60", uses: 1 }
    ]);
  });

  test("項目は条件付けをそのまま持ち、プロパティには読める形で載る", () => {
    const item = model.items.find(candidate => candidate.sourceLine === 4);
    assert.strictEqual(item?.condition.kind, "indicators");
    assert.strictEqual(item?.attributes.condition, "01");
    const unconditional = model.items.find(candidate => candidate.sourceLine === 6);
    assert.strictEqual(unconditional?.condition.kind, "none");
    assert.strictEqual(unconditional?.attributes.condition, undefined);
  });

  test("不成立の項目だけがキャンバスから消える", () => {
    assert.ok(drawn({ "50": "on" }).includes(2));
    assert.ok(!drawn({ "50": "on" }).includes(3));
    assert.ok(!drawn({ "50": "off" }).includes(2));
    assert.ok(drawn({ "50": "off" }).includes(3));
  });

  test("未設定を含む条件の項目は消えない", () => {
    // 01 だけ倒しても、02 で条件付けられた項目は「出るとも出ないとも決まらない」。
    assert.ok(drawn({ "01": "off" }).includes(5));
  });

  test("消えた項目は一覧に理由付きで残る", () => {
    assert.strictEqual(outlineItem({ "50": "off" }, 2)?.hidden, "condition-off");
    assert.strictEqual(outlineItem({ "50": "off" }, 3)?.hidden, undefined);
  });

  test("構造的な理由が既にある項目は上書きしない", () => {
    // 位置が無い項目は標識をどう倒しても描かれない。そちらを先に伝えるほうが直しに繋がる。
    assert.strictEqual(outlineItem({ "60": "off" }, 8)?.hidden, "no-position");
  });

  test("その状態で同時に出る項目の重なりを足す", () => {
    const codes = applyIndicators(model, { "01": "on", "02": "on" }).diagnostics.map(d => d.code);
    assert.ok(codes.includes("overlap-under-indicators"));
    const message = applyIndicators(model, { "01": "on", "02": "on" })
      .diagnostics.find(d => d.code === "overlap-under-indicators")?.message;
    assert.ok(message?.includes("01=オン, 02=オン"), message);
    assert.ok(message?.includes("FLD1") && message?.includes("FLD2"), message);
  });

  test("指摘にはその組が使う標識だけを添える", () => {
    // 設定中の標識をすべて並べると、無関係な標識まで載って「何を戻せば消えるか」が読めなくなる。
    const message = applyIndicators(model, { "01": "on", "02": "on", "50": "off" })
      .diagnostics.find(d => d.code === "overlap-under-indicators")?.message;
    assert.ok(message?.includes("標識 01=オン, 02=オン のとき"), message);
    assert.ok(!message?.includes("50="), message);
  });

  test("片方が未設定なら重なりを足さない", () => {
    const codes = applyIndicators(model, { "01": "on" }).diagnostics.map(d => d.code);
    assert.ok(!codes.includes("overlap-under-indicators"));
  });

  test("両方とも無条件の重なりは二重に出さない", () => {
    // BASE1 / BASE2 は `resolveDspfLayout` が既に `overlap` で報告している。
    const base = model.diagnostics.filter(d => d.code === "overlap").length;
    const after = applyIndicators(model, { "01": "on", "02": "on" }).diagnostics;
    assert.strictEqual(base, 1);
    assert.strictEqual(after.filter(d => d.code === "overlap").length, 1);
    assert.strictEqual(
      after.filter(d => d.code === "overlap-under-indicators" && d.message.includes("BASE")).length,
      0
    );
  });

  test("状態を指定しなければ重なりは足さない", () => {
    assert.deepStrictEqual(
      applyIndicators(model, {}).diagnostics.map(d => d.code),
      model.diagnostics.map(d => d.code)
    );
  });
});
