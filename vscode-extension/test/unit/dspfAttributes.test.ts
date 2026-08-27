import * as assert from "assert";
import {
  DEFAULT_APPEARANCE,
  resolveAppearance
} from "../../src/core/dds/dspfAttributes";
import attributeData from "../../resources/completion/dds-attributes.json";

/**
 * 5250 の配色。
 *
 * ## 期待値の出所
 *
 * 対応表は**原典から生成**したもの（`docs/origin/generate-dds-attributes.mjs`）で、
 * `verify-dds-attributes.mjs` が原典の 2 つの表（16 進表 と COLOR ページの表）の
 * 一致まで見ている。
 *
 * さらに**実機の画面と全 61 通りを突き合わせて**確認済み
 * （`.aidev/works/20260827-dds-5250-colors/verify/verify-attributes.mjs`）。
 * ここに書いてある期待値は、その実測と同じもの。
 */

const of = (keywords: string) => resolveAppearance(keywords);

suite("5250 の配色: COLOR", () => {
  const CASES: ReadonlyArray<[string, string]> = [
    ["GRN", "green"],
    ["WHT", "white"],
    ["RED", "red"],
    ["TRQ", "turquoise"],
    ["YLW", "yellow"],
    ["PNK", "pink"],
    ["BLU", "blue"]
  ];

  for (const [keyword, color] of CASES) {
    test(`COLOR(${keyword}) は ${color}`, () => {
      assert.strictEqual(of(`'X' COLOR(${keyword})`).color, color);
    });
  }

  test("COLOR が無ければ緑（原典: 緑はデフォルトの色）", () => {
    assert.strictEqual(of("'X'").color, "green");
    assert.deepStrictEqual(of("'X'"), DEFAULT_APPEARANCE);
  });

  test("**最初の COLOR が効く**（原典）", () => {
    assert.strictEqual(of("'X' COLOR(RED) COLOR(BLU)").color, "red");
  });

  test("知らない色は無視する（緑のまま）", () => {
    assert.strictEqual(of("'X' COLOR(ZZZ)").color, "green");
  });
});

suite("5250 の配色: COLOR を書かないときは CS / HI / BL で決まる", () => {
  // 原典（COLOR ページ 表 1）。生成物にも同じ表が入っている。
  const CASES: ReadonlyArray<[string, string, boolean]> = [
    ["", "green", false],
    ["CS", "turquoise", false],
    ["HI", "white", false],
    ["BL", "red", false],
    ["HI BL", "red", true],
    ["CS HI", "yellow", false],
    ["CS BL", "pink", false],
    ["CS HI BL", "blue", false]
  ];

  for (const [attrs, color, blink] of CASES) {
    test(`DSPATR(${attrs || "なし"}) は ${color}${blink ? "・明滅" : ""}`, () => {
      const appearance = of(attrs ? `'X' DSPATR(${attrs})` : "'X'");
      assert.strictEqual(appearance.color, color);
      assert.strictEqual(appearance.blink, blink, "明滅");
    });
  }

  test("生成物の色の表と一致する（表を 2 か所に持たない）", () => {
    for (const row of attributeData.colors) {
      const attrs = [row.cs && "CS", row.hi && "HI", row.bl && "BL"].filter(Boolean).join(" ");
      const appearance = of(attrs ? `'X' DSPATR(${attrs})` : "'X'");
      assert.strictEqual(appearance.color, row.color, attrs);
      assert.strictEqual(appearance.blink, row.blink, attrs);
    }
  });
});

suite("5250 の配色: 反転表示・下線", () => {
  test("RI は反転表示", () => {
    assert.strictEqual(of("'X' DSPATR(RI)").reverse, true);
  });

  test("UL は下線", () => {
    assert.strictEqual(of("'X' DSPATR(UL)").underline, true);
  });

  test("COLOR と併せても効く", () => {
    const appearance = of("'X' COLOR(RED) DSPATR(RI UL)");
    assert.strictEqual(appearance.color, "red");
    assert.strictEqual(appearance.reverse, true);
    assert.strictEqual(appearance.underline, true);
  });

  test("**COLOR を書くと CS / HI / BL は色に吸収される**", () => {
    // 原典が「HI は無視されます」等と散文で並べているのはこのこと。
    assert.strictEqual(of("'X' COLOR(YLW) DSPATR(HI)").color, "yellow");
    assert.strictEqual(of("'X' COLOR(GRN) DSPATR(BL)").color, "green");
    assert.strictEqual(of("'X' COLOR(GRN) DSPATR(BL)").blink, false);
  });
});

suite("5250 の配色: 書いたのに出ない組み合わせ", () => {
  test("**UL ＋ HI ＋ RI は非表示**（原典: ND と同じ結果）", () => {
    const appearance = of("'X' DSPATR(UL HI RI)");
    assert.strictEqual(appearance.nonDisplay, true);
  });

  test("ND は非表示", () => {
    assert.strictEqual(of("'X' DSPATR(ND)").nonDisplay, true);
  });

  test("非表示のときは他の属性を立てない（何も出ないので意味が無い）", () => {
    const appearance = of("'X' DSPATR(ND RI UL)");
    assert.strictEqual(appearance.reverse, false);
    assert.strictEqual(appearance.underline, false);
    assert.strictEqual(appearance.blink, false);
  });

  test("**COLOR ＋ RI ＋ UL は UL が落ちる**（実機で確認。原典は RI と書いている）", () => {
    // 白・黄・青は色に HI を含むので、RI と UL を足すと 0x_7（非表示）になってしまう。
    // 実機は UL を落として非表示にしない。
    for (const color of ["WHT", "YLW", "BLU"]) {
      const appearance = of(`'X' COLOR(${color}) DSPATR(RI UL)`);
      assert.strictEqual(appearance.nonDisplay, false, color);
      assert.strictEqual(appearance.reverse, true, color);
      assert.strictEqual(appearance.underline, false, `${color}: UL が落ちていない`);
    }
  });

  test("HI を含まない色では RI ＋ UL が両方効く", () => {
    for (const color of ["GRN", "RED", "TRQ", "PNK"]) {
      const appearance = of(`'X' COLOR(${color}) DSPATR(RI UL)`);
      assert.strictEqual(appearance.nonDisplay, false, color);
      assert.strictEqual(appearance.underline, true, color);
    }
  });
});

suite("5250 の配色: 見え方に効かないキーワード", () => {
  for (const value of ["PC", "MDT", "OID", "SP", "PR"]) {
    test(`DSPATR(${value}) は色にも属性にも効かない`, () => {
      assert.deepStrictEqual(of(`'X' DSPATR(${value})`), DEFAULT_APPEARANCE);
    });
  }

  test("他のキーワードは無視する", () => {
    assert.deepStrictEqual(of("'X' CHECK(RZ) EDTCDE(1)"), DEFAULT_APPEARANCE);
  });
});

suite("5250 の配色: 属性バイト", () => {
  test("既定は 0x20", () => {
    assert.strictEqual(DEFAULT_APPEARANCE.byte, 0x20);
  });

  test("**DSPATR の全 32 通りが原典の 16 進表に収まる**", () => {
    const FLAGS = ["CS", "HI", "BL", "RI", "UL"];
    const bytes = new Set<number>();
    for (let mask = 0; mask < 32; mask += 1) {
      const attrs = FLAGS.filter((_, index) => mask & (1 << index));
      const appearance = of(`'X' DSPATR(${attrs.join(" ") || "PC"})`);
      assert.ok(
        attributeData.attributes.some(row => row.byte === appearance.byte),
        `0x${appearance.byte.toString(16)} が 16 進表に無い（${attrs.join(" ")}）`
      );
      bytes.add(appearance.byte);
    }
    // 32 通りの組み合わせが 32 通りのバイトになる（潰れていない）。
    assert.strictEqual(bytes.size, 32);
  });
});
