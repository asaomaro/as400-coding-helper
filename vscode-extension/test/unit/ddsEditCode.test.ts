import * as assert from "assert";
import {
  DECLARED_EDIT_CODES,
  USER_DEFINED_EDIT_CODES,
  editCodeAttributes,
  editedWidth
} from "../../src/core/dds/editCode";

/**
 * `EDTCDE` の印刷桁数。
 *
 * 属性の表は原典から生成しているので、ここで見るのは**属性から幅を導く式**。
 * 原典の 20 コードすべてに期待値を置く（表が生成物でも、式は手書きなので）。
 */

/** 9 桁・小数 2 桁（`CUSTMST.pf` の `CUSTAM` と同じ形）。 */
const LEN = 9;
const DEC = 2;

suite("EDTCDE: 原典の 20 コードすべて", () => {
  // 期待値は「整数部 7 桁・小数 2 桁」に対する印刷幅。
  //   基本 9 桁
  //   + コンマ（整数部 7 桁 → 2 個）
  //   + 小数点 1
  //   + 符号（CR=2 / マイナス=1 / なし=0）
  const cases: ReadonlyArray<readonly [string, number]> = [
    // 1-4: 符号なし
    ["1", 9 + 2 + 1],
    ["2", 9 + 2 + 1],
    ["3", 9 + 0 + 1], // コンマなし
    ["4", 9 + 0 + 1],
    // A-D: CR
    ["A", 9 + 2 + 1 + 2],
    ["B", 9 + 2 + 1 + 2],
    ["C", 9 + 0 + 1 + 2],
    ["D", 9 + 0 + 1 + 2],
    // J-Q: マイナス
    ["J", 9 + 2 + 1 + 1],
    ["K", 9 + 2 + 1 + 1],
    ["L", 9 + 0 + 1 + 1],
    ["M", 9 + 0 + 1 + 1],
    ["N", 9 + 2 + 1 + 1],
    ["O", 9 + 2 + 1 + 1],
    ["P", 9 + 0 + 1 + 1],
    ["Q", 9 + 0 + 1 + 1],
    // W-Z: 編集しない / 日付 / 符号除去
    ["W", 9],
    ["X", 9],
    ["Y", 9],
    ["Z", 9]
  ];

  test("原典が宣言する 20 コードすべてに期待値がある", () => {
    assert.strictEqual(DECLARED_EDIT_CODES.length, 20);
    assert.deepStrictEqual(
      [...cases.map(([code]) => code)].sort(),
      [...DECLARED_EDIT_CODES].sort(),
      "テストの網羅が原典の宣言とずれている"
    );
  });

  for (const [code, expected] of cases) {
    test(`${code}: 9 桁(小数 2) → ${expected} 桁`, () => {
      const result = editedWidth(LEN, DEC, code);
      assert.strictEqual(result.kind, "width", `${code} は幅が出るはず`);
      assert.strictEqual(
        result.kind === "width" ? result.width : -1,
        expected
      );
    });
  }
});

suite("EDTCDE: 解決できない場合", () => {
  test("ユーザー定義 5-9 は unknown（実機の *EDTD）", () => {
    assert.strictEqual(USER_DEFINED_EDIT_CODES.length, 5);
    for (const code of USER_DEFINED_EDIT_CODES) {
      const result = editedWidth(LEN, DEC, code);
      assert.strictEqual(result.kind, "unknown");
      assert.strictEqual(
        result.kind === "unknown" ? result.reason : "",
        "user-defined"
      );
    }
  });

  test("数字以外のデータ・タイプには効かない（原典: S かブランクのみ）", () => {
    const result = editedWidth(LEN, DEC, "1", undefined, "A");
    assert.strictEqual(result.kind, "unknown");
    assert.strictEqual(
      result.kind === "unknown" ? result.reason : "",
      "not-numeric"
    );
  });

  test("S とブランクには効く", () => {
    assert.strictEqual(editedWidth(LEN, DEC, "1", undefined, "S").kind, "width");
    assert.strictEqual(editedWidth(LEN, DEC, "1", undefined, " ").kind, "width");
    assert.strictEqual(editedWidth(LEN, DEC, "1", undefined, "").kind, "width");
  });

  test("知らないコードは unknown", () => {
    assert.strictEqual(editedWidth(LEN, DEC, "V").kind, "unknown");
  });
});

suite("EDTCDE: 幅の導き方", () => {
  test("コンマは整数部にだけ入る", () => {
    // 整数部 7 桁 → 区切り 2 個
    assert.deepStrictEqual(editedWidth(9, 2, "1"), { kind: "width", width: 12 });
    // 整数部 3 桁 → 区切りなし
    assert.deepStrictEqual(editedWidth(5, 2, "1"), { kind: "width", width: 6 });
    // 整数部 4 桁 → 区切り 1 個
    assert.deepStrictEqual(editedWidth(6, 2, "1"), { kind: "width", width: 8 });
  });

  test("小数部が無ければ小数点は入らない", () => {
    assert.deepStrictEqual(editedWidth(5, 0, "1"), { kind: "width", width: 6 });
  });

  test("浮動通貨記号は 1 桁増える", () => {
    const plain = editedWidth(9, 2, "1");
    const currency = editedWidth(9, 2, "1", "$");
    assert.strictEqual(
      (currency as { width: number }).width - (plain as { width: number }).width,
      1
    );
  });

  test("アスタリスク充てんは桁を増やさない（抑制されたゼロを埋めるだけ）", () => {
    assert.deepStrictEqual(editedWidth(9, 2, "1", "*"), editedWidth(9, 2, "1"));
  });

  test("属性は原典由来の表から引く", () => {
    assert.deepStrictEqual(editCodeAttributes("1"), {
      commas: true,
      decimalPoint: true,
      negativeSign: "none",
      zeroBalance: "zero",
      suppressLeadingZero: true
    });
    // 3 はコンマなし。テキスト化して読むと 1 と区別が付かなくなる箇所。
    assert.strictEqual(editCodeAttributes("3")?.commas, false);
  });
});
