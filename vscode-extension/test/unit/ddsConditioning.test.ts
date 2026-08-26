import * as assert from "assert";
import {
  collectIndicators,
  conditionGroups,
  describeConditioning,
  evaluateConditioning,
  readConditioning,
  type Conditioning,
  type IndicatorStates
} from "../../src/core/dds/ddsConditioning";

/**
 * 条件付け欄（7-16 桁）の解決。
 *
 * 原典（`表示装置ファイルの条件付け (7 - 16 桁目)`）:
 * > 2 - 9 個の標識を AND により結び付けて 1 つの条件にすることができます。
 * > OR で結ばれる複数の条件を指定する場合には、各条件をそれぞれ新しい行から書き始め、
 * > 最初の条件以外のすべての条件については、7 桁目に O を指定しなければなりません。
 * > 最初の条件に O を指定した場合には、警告メッセージが出て、この桁はブランクとして処理されます。
 *
 * **守るのは「行 → 条件の畳み込み」と「未設定を偽に倒さないこと」**。
 * 未設定を偽に倒すと、標識を 1 つ設定しただけで無関係な項目が消える。
 */

/** 7-16 桁を作る（`     A` の 6 桁のあと、7 桁目から）。 */
function line(conditioning: string, rest = ""): string {
  return `     A${conditioning.padEnd(10, " ")}${rest}`;
}

function read(...conditioning: string[]): Conditioning {
  return readConditioning(conditioning.map(area => line(area)));
}

/** 条件の組を `["01 N02", "03"]` の形にして比べる（読みやすさのため）。 */
function groups(conditioning: Conditioning): string[] {
  return conditionGroups(conditioning).map(terms =>
    terms.map(term => `${term.negated ? "N" : ""}${term.indicator}`).join(" ")
  );
}

suite("条件付け: 行を条件へ畳む", () => {
  test("1 行 1 標識", () => {
    assert.deepStrictEqual(groups(read("  01")), ["01"]);
  });

  test("同じ行の 3 枠は AND（8-10 / 11-13 / 14-16 桁）", () => {
    assert.deepStrictEqual(groups(read("  01N02 03")), ["01 N02 03"]);
  });

  test("2 行目のブランクは AND の継続（原典: A が既定）", () => {
    assert.deepStrictEqual(groups(read("  01", "  02")), ["01 02"]);
  });

  test("2 行目の A も AND の継続", () => {
    assert.deepStrictEqual(groups(read("  01", "A 02")), ["01 02"]);
  });

  test("O は新しい条件を開始する", () => {
    assert.deepStrictEqual(groups(read("  01", "O 02")), ["01", "02"]);
  });

  test("1 行目の O はブランク扱い（原典: 警告が出てブランクとして処理される）", () => {
    assert.deepStrictEqual(groups(read("O 01", "O 02")), ["01", "02"]);
  });

  test("AND と OR が混ざる", () => {
    assert.deepStrictEqual(groups(read("  01", "  02", "O 03", "  04")), ["01 02", "03 04"]);
  });

  test("条件が無ければ組も無い", () => {
    assert.deepStrictEqual(groups(read("    ")), []);
  });

  test("画面サイズ条件名は標識の組にならない", () => {
    assert.deepStrictEqual(groups(read(" *DS3")), []);
  });
});

suite("条件付け: 3 値で解決する", () => {
  const evaluate = (conditioning: Conditioning, states: IndicatorStates) =>
    evaluateConditioning(conditioning, states);

  test("条件が無ければ常に表示", () => {
    assert.strictEqual(evaluate(read("    "), {}), "shown");
    assert.strictEqual(evaluate(read("    "), { "01": "off" }), "shown");
  });

  test("画面サイズ条件名は常に表示（不一致は配置解決が既に落としている）", () => {
    assert.strictEqual(evaluate(read(" *DS3"), {}), "shown");
  });

  test("未設定は決めない", () => {
    assert.strictEqual(evaluate(read("  01"), {}), "unknown");
  });

  test("オンで成立・オフで不成立", () => {
    assert.strictEqual(evaluate(read("  01"), { "01": "on" }), "shown");
    assert.strictEqual(evaluate(read("  01"), { "01": "off" }), "hidden");
  });

  test("N はオフのときに成立（原典: 8/11/14 桁目 (NOT)）", () => {
    assert.strictEqual(evaluate(read(" N01"), { "01": "off" }), "shown");
    assert.strictEqual(evaluate(read(" N01"), { "01": "on" }), "hidden");
  });

  test("AND は 1 つでも偽なら偽（未設定が残っていても）", () => {
    assert.strictEqual(evaluate(read("  01 02"), { "01": "off" }), "hidden");
  });

  test("AND は偽が無く未設定が残れば未知", () => {
    assert.strictEqual(evaluate(read("  01 02"), { "01": "on" }), "unknown");
  });

  test("AND は全部真なら真", () => {
    assert.strictEqual(evaluate(read("  01 02"), { "01": "on", "02": "on" }), "shown");
  });

  test("OR は 1 つでも真なら真（残りが未設定でも）", () => {
    assert.strictEqual(evaluate(read("  01", "O 02"), { "01": "on" }), "shown");
  });

  test("OR は真が無く未設定が残れば未知", () => {
    assert.strictEqual(evaluate(read("  01", "O 02"), { "01": "off" }), "unknown");
  });

  test("OR は全部偽なら偽", () => {
    assert.strictEqual(
      evaluate(read("  01", "O 02"), { "01": "off", "02": "off" }),
      "hidden"
    );
  });

  test("鍵が 2 桁でない状態は当たらない（例外にしない）", () => {
    assert.strictEqual(evaluate(read("  01"), { "1": "on" }), "unknown");
  });
});

suite("条件付け: 人が読む形", () => {
  test("AND は「かつ」、OR は「または」", () => {
    assert.strictEqual(describeConditioning(read("  01N02", "O 03")), "01 かつ N02、または 03");
  });

  test("条件が無ければ空", () => {
    assert.strictEqual(describeConditioning(read("    ")), "");
  });

  test("画面サイズ条件名はそのまま出す", () => {
    assert.strictEqual(describeConditioning(read(" *DS3")), "*DS3");
  });

  test("ソースに書いてある形（N 付き）で出す", () => {
    // 「オフのとき」と書き下すと、プロパティから該当行を目で探せなくなる。
    assert.strictEqual(describeConditioning(read(" N05")), "N05");
  });
});

suite("条件付け: ソース中の標識を列挙する", () => {
  const SOURCE = [
    "     A*  条件標識の確認",
    "     A                                      DSPSIZ(24 80 *DS3)",
    "     A          R TEST",
    "     A  50                              3  2'部門名'",
    "     A N50                              3  2'（未設定）'",
    "     A            FLD1          10A  O  5  2",
    "     A  30                                  DSPATR(RI)",
    "     A  01 02 03                        7  2'AND'",
    "     A *DS3                             9  2'2 次画面'",
    "",
    "     A            FLD2          10A  O 11  2"
  ];

  test("番号順・使用桁数つきで返す", () => {
    assert.deepStrictEqual(collectIndicators(SOURCE), [
      { indicator: "01", uses: 1 },
      { indicator: "02", uses: 1 },
      { indicator: "03", uses: 1 },
      { indicator: "30", uses: 1 },
      { indicator: "50", uses: 2 }
    ]);
  });

  test("キーワードだけの行の標識も拾う（原典: 条件はフィールドまたはキーワードに付く）", () => {
    // `30 DSPATR(RI)` は論理単位では直前の項目のキーワードに畳まれ、条件付け欄が落ちる。
    const only = collectIndicators(["     A  30                                  DSPATR(RI)"]);
    assert.deepStrictEqual(only, [{ indicator: "30", uses: 1 }]);
  });

  test("N の有無で別の標識にはならない", () => {
    const usage = collectIndicators(SOURCE).find(item => item.indicator === "50");
    assert.deepStrictEqual(usage, { indicator: "50", uses: 2 });
  });

  test("注記行の 7 桁目（*）を条件として読まない", () => {
    assert.deepStrictEqual(collectIndicators(["     A*  01  これは注記"]), []);
  });

  test("画面サイズ条件名は標識ではない", () => {
    assert.deepStrictEqual(collectIndicators(["     A *DS3                             9  2'X'"]), []);
  });

  test("使われていなければ空", () => {
    assert.deepStrictEqual(collectIndicators(["     A          R TEST"]), []);
  });
});
