import * as assert from "assert";
import { isDbcsCodePoint, printWidth } from "../../src/core/dbcs";

/**
 * 実機での印刷桁数。
 *
 * **ローカルのソースに SO/SI は存在しない**（`.pf` を生バイトで確認済み。日本語は
 * UTF-8 のままで `0x0E`/`0x0F` が無い）。実機では DBCS の連なりの前後に SO/SI が
 * 1 桁ずつ入り、全角 1 文字が 2 桁を占めるので、**ソースに無い分を計算で足す**。
 *
 * 競合（IBM i Renderer）はここを `value.length` で済ませており、
 * `'顧客一覧表'` を 5 桁と見積もって 7 桁ずれる。
 */
suite("DBCS: 実機の印刷桁数", () => {
  test("半角だけなら文字数と同じ", () => {
    assert.strictEqual(printWidth("ABC"), 3);
    assert.strictEqual(printWidth("12345"), 5);
    assert.strictEqual(printWidth(""), 0);
  });

  test("全角だけなら SO + 2×文字数 + SI", () => {
    // 競合はこれを 5 と数える。実機は 12。
    assert.strictEqual(printWidth("顧客一覧表"), 12);
    assert.strictEqual(printWidth("漢"), 1 + 2 + 1);
  });

  test("半角と全角が混ざる場合", () => {
    // A + SO + 顧客(4) + SI + B
    assert.strictEqual(printWidth("A顧客B"), 8);
  });

  test("DBCS が途切れるたびに SO/SI が要る", () => {
    // (SO+2+SI) + Z + (SO+2+SI) = 4 + 1 + 4
    assert.strictEqual(
      printWidth("あZい"),
      9,
      "全角の総数だけ数えると 6 になってしまう"
    );
  });

  test("行末まで全角が続く場合も SI が入る", () => {
    assert.strictEqual(printWidth("A顧客"), 1 + 1 + 4 + 1);
  });

  test("全角英数・記号も DBCS として数える", () => {
    assert.strictEqual(printWidth("ＡＢ"), 1 + 4 + 1);
  });

  test("実サンプルの定数（CUSTRPT.prtf）", () => {
    // docs/src/CUSTRPT.prtf の 30 桁目に置かれている定数。
    assert.strictEqual(printWidth("顧客一覧表"), 12);
  });
});

suite("DBCS: 全角の判定", () => {
  test("ひらがな・カタカナ・漢字は全角", () => {
    for (const character of ["あ", "ア", "漢", "客"]) {
      assert.strictEqual(
        isDbcsCodePoint(character.codePointAt(0)!),
        true,
        `${character} は全角のはず`
      );
    }
  });

  test("半角英数記号は全角ではない", () => {
    for (const character of ["A", "1", " ", "'", "("]) {
      assert.strictEqual(
        isDbcsCodePoint(character.codePointAt(0)!),
        false,
        `${character} は半角のはず`
      );
    }
  });

  test("半角カナは全角として扱わない", () => {
    // U+FF61-FF9F。実機でも 1 バイトなので SO/SI が要らない。
    assert.strictEqual(isDbcsCodePoint("ｱ".codePointAt(0)!), false);
  });
});
