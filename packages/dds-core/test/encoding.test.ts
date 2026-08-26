import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import {
  isDbcsCodePoint,
  displayWidth,
  charIndexToColumn,
  columnToCharIndex,
  sosiPositions
} from "../src/text/encoding.js";

/**
 * research の実測値そのもの。`ASAOLIB/QJPNTEST(JPNATTR)` を IFS から生バイトで読み、
 * `CPYTOSTMF` で UTF-8 化して読み戻した結果:
 *
 *   実機(EBCDIC): c1 e7 28 0e 45e2 45c9 0f c3 c4   = 11 バイト = 11 表示桁
 *   UTF-8 変換後: 41 58 c288 e8a8ad e8a888 43 44   = 7 文字
 *
 * 0x28 は EBCDIC 上の非表示バイトで、UTF-8 では U+0088 に写る。
 */
const REAL_MEMBER = "AX設計CD";

describe("実測値の固定（このモジュールが存在する理由）", () => {
  test("実機メンバ相当の文字列は 11 表示桁を占める", () => {
    // A(1) X(1) U+0088(1) SO(1) 設(2) 計(2) SI(1) C(1) D(1) = 11
    assert.equal(displayWidth(REAL_MEMBER), 11);
  });

  test("同じ文字列の UTF-16 長は 7 で、表示桁と一致しない", () => {
    assert.equal(REAL_MEMBER.length, 7);
    assert.notEqual(REAL_MEMBER.length, displayWidth(REAL_MEMBER));
  });

  test("SO/SI の位置が実機の並びと一致する", () => {
    // SO は 設 の直前(4 桁目)、SI は 計 の直後(9 桁目)。
    assert.deepEqual(sosiPositions(REAL_MEMBER), { so: [4], si: [9] });
  });

  test("各文字の開始桁が実機の並びと一致する", () => {
    const columns = [...REAL_MEMBER].map((_, index) =>
      charIndexToColumn(REAL_MEMBER, index)
    );
    //            A  X    設  計   C   D
    assert.deepEqual(columns, [1, 2, 3, 5, 7, 10, 11]);
  });
});

describe("DBCS 判定（既存実装からの移送・AC8）", () => {
  // 移送元 vscode-extension/src/language/dbcsShiftMarkers.ts の範囲を、
  // 境界値で網羅する。ここが動いたら既存の SOSI 表示と桁が食い違う。
  const cases: ReadonlyArray<readonly [number, boolean, string]> = [
    [0x0041, false, "A"],
    [0x0088, false, "U+0088（実機メンバに現れる非表示バイト）"],
    [0x303f, false, "Hiragana 範囲の直前"],
    [0x3040, true, "Hiragana 範囲の下端"],
    [0x30ff, true, "Katakana 範囲の上端"],
    [0x3100, false, "Katakana 範囲の直後"],
    [0x33ff, false, "CJK 範囲の直前"],
    [0x3400, true, "CJK Ext.A の下端"],
    [0x9fff, true, "CJK Unified の上端"],
    [0xa000, false, "CJK 範囲の直後"],
    [0xf8ff, false, "CJK 互換の直前"],
    [0xf900, true, "CJK 互換の下端"],
    [0xfaff, true, "CJK 互換の上端"],
    [0xfb00, false, "CJK 互換の直後"],
    [0xff00, false, "全角英数の直前"],
    [0xff01, true, "全角英数の下端"],
    [0xff60, true, "全角英数の上端"],
    [0xff61, false, "半角カタカナ（全角ではない）"],
    [0xffdf, false, "全角通貨記号の直前"],
    [0xffe0, true, "全角通貨記号の下端"],
    [0xffe6, true, "全角通貨記号の上端"],
    [0xffe7, false, "全角通貨記号の直後"]
  ];

  for (const [codePoint, expected, label] of cases) {
    test(`U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} は ${expected ? "DBCS" : "非 DBCS"}（${label}）`, () => {
      assert.equal(isDbcsCodePoint(codePoint), expected);
    });
  }
});

describe("境界", () => {
  test("空文字列は 0 桁で、末尾索引は 1 桁目を指す", () => {
    assert.equal(displayWidth(""), 0);
    assert.equal(charIndexToColumn("", 0), 1);
  });

  test("DBCS run が文字列の先頭に接する", () => {
    // SO(1) 設(2,3) SI(4) A(5)
    const text = "設A";
    assert.equal(displayWidth(text), 5);
    assert.equal(charIndexToColumn(text, 0), 2);
    assert.equal(charIndexToColumn(text, 1), 5);
    assert.deepEqual(sosiPositions(text), { so: [1], si: [4] });
  });

  test("DBCS run が文字列の末尾に接すると、末尾 SI が数え込まれる", () => {
    // A(1) SO(2) 設(3,4) SI(5)
    const text = "A設";
    assert.equal(displayWidth(text), 5);
    assert.deepEqual(sosiPositions(text), { so: [2], si: [5] });
    // 末尾索引は SI の次を指す。ここを落とすと後続の桁が 1 つずれる。
    assert.equal(charIndexToColumn(text, 2), 6);
  });

  test("run 終了直後の索引で SI が数え込まれる", () => {
    // A(1) SO(2) 設(3,4) SI(5) B(6)
    const text = "A設B";
    assert.equal(charIndexToColumn(text, 2), 6);
  });

  test("範囲外の索引は RangeError", () => {
    assert.throws(() => charIndexToColumn("AB", 3), RangeError);
    assert.throws(() => charIndexToColumn("AB", -1), RangeError);
  });

  test("桁 0 以下は RangeError（桁は 1 始まり）", () => {
    assert.throws(() => columnToCharIndex("AB", 0), RangeError);
  });
});

describe("straddles（黙って丸めない）", () => {
  test("DBCS の 2 桁目を指すと straddles", () => {
    // 設 は 5,6 桁目。6 桁目は 2 桁目にあたる。
    assert.deepEqual(columnToCharIndex(REAL_MEMBER, 6), {
      index: 3,
      straddles: true
    });
  });

  test("SO の桁を指すと straddles（直後の DBCS 文字を指す）", () => {
    assert.deepEqual(columnToCharIndex(REAL_MEMBER, 4), {
      index: 3,
      straddles: true
    });
  });

  test("SI の桁を指すと straddles（run 直後の文字を指す）", () => {
    assert.deepEqual(columnToCharIndex(REAL_MEMBER, 9), {
      index: 5,
      straddles: true
    });
  });

  test("文字の開始桁なら straddles ではない", () => {
    assert.deepEqual(columnToCharIndex(REAL_MEMBER, 5), {
      index: 3,
      straddles: false
    });
  });

  test("表示幅を超える桁は末尾を指す（DDS 行は空白で右詰めされるため正当）", () => {
    assert.deepEqual(columnToCharIndex(REAL_MEMBER, 40), {
      index: REAL_MEMBER.length,
      straddles: false
    });
  });
});

describe("往復", () => {
  test("文字の開始桁を経由すると元の索引に戻る", () => {
    const samples = [REAL_MEMBER, "A設B", "設A", "ABC", "設計"];
    for (const text of samples) {
      for (let index = 0; index < text.length; index += 1) {
        const column = charIndexToColumn(text, index);
        const back = columnToCharIndex(text, column);
        assert.deepEqual(
          back,
          { index, straddles: false },
          `${JSON.stringify(text)} の索引 ${index}`
        );
      }
    }
  });
});

describe("サロゲートペア（現行挙動の再現）", () => {
  // U+20B9F。判定範囲はすべて BMP なので DBCS とはみなされないが、
  // UTF-16 では 2 コード単位を消費する。EBCDIC に対応字が無く実務では現れない。
  const SURROGATE = "\u{20B9F}";

  test("DBCS とはみなされない", () => {
    assert.equal(isDbcsCodePoint(0x20b9f), false);
  });

  test("2 コード単位を消費するが 1 桁しか占めない", () => {
    assert.equal(SURROGATE.length, 2);
    assert.equal(displayWidth(SURROGATE), 1);
  });

  test("末尾索引は次の桁を指す", () => {
    assert.equal(charIndexToColumn(SURROGATE, 0), 1);
    assert.equal(charIndexToColumn(SURROGATE, 2), 2);
  });
});
