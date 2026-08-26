import { strict as assert } from "node:assert";
import { test, describe } from "node:test";
import { parse } from "../src/dds/parse.js";
import { validate, DIAGNOSTIC_CODES, itemWidth } from "../src/dds/validate.js";
import type { ItemLine } from "../src/dds/model.js";
import { ln } from "./helpers.js";

function diagnose(lines: string[]): ReturnType<typeof validate> {
  return validate(parse([ln({ rec: "TEST" }), ...lines, ""].join("\n")));
}

function codes(lines: string[]): string[] {
  return diagnose(lines).map(d => d.code);
}

/**
 * spec D7 の実測表をそのまま回帰テストにする。
 * **すべて実機の `CRTDSPF` で `CPD7866` の有無を確認した値**（推測ではない）。
 */
describe("属性バイトの隣接規則（実機で確定した値の回帰テスト）", () => {
  test("定数 ABCDE(2-6) の直後 7 桁目にフィールド → 違反", () => {
    assert.deepEqual(
      codes([
        ln({ row: 3, col: 2, func: "'ABCDE'" }),
        ln({ name: "FLD1", len: 5, type: "A", usage: "O", row: 3, col: 7 })
      ]),
      [DIAGNOSTIC_CODES.attributeAdjacency]
    );
  });

  test("定数 ABCDE(2-6) から 1 桁空けて 8 桁目 → OK", () => {
    assert.deepEqual(
      codes([
        ln({ row: 3, col: 2, func: "'ABCDE'" }),
        ln({ name: "FLD1", len: 5, type: "A", usage: "O", row: 3, col: 8 })
      ]),
      []
    );
  });

  test("フィールド(8-12) の直後 13 桁目に定数 → 違反（後続の属性バイト）", () => {
    assert.deepEqual(
      codes([
        ln({ name: "FLDA", len: 5, type: "A", usage: "O", row: 9, col: 8 }),
        ln({ row: 9, col: 13, func: "'XY'" })
      ]),
      [DIAGNOSTIC_CODES.attributeAdjacency]
    );
  });

  test("フィールド(8-12) から 1 桁空けて 14 桁目 → OK", () => {
    assert.deepEqual(
      codes([
        ln({ name: "FLDB", len: 5, type: "A", usage: "O", row: 11, col: 8 }),
        ln({ row: 11, col: 14, func: "'XY'" })
      ]),
      []
    );
  });

  test("定数 AB(2-3) の直後 4 桁目に定数 → 違反（定数にも属性バイトがある）", () => {
    assert.deepEqual(
      codes([
        ln({ row: 19, col: 2, func: "'AB'" }),
        ln({ row: 19, col: 4, func: "'CD'" })
      ]),
      [DIAGNOSTIC_CODES.attributeAdjacency]
    );
  });

  test("定数 AB(2-3) から 1 桁空けて 5 桁目 → OK（空き 1 桁を前後で兼用する）", () => {
    assert.deepEqual(
      codes([
        ln({ row: 21, col: 2, func: "'AB'" }),
        ln({ row: 21, col: 5, func: "'CD'" })
      ]),
      []
    );
  });

  test("桁 1 に置いても違反にならない（左に隣接相手がいない）", () => {
    assert.deepEqual(
      codes([ln({ name: "FLD9", len: 5, type: "A", usage: "O", row: 5, col: 1 })]),
      []
    );
  });

  test("76-80 桁のフィールドは桁溢れにならない（後続属性は画面外でよい）", () => {
    assert.deepEqual(
      codes([ln({ name: "FLDX", len: 5, type: "A", usage: "O", row: 15, col: 76 })]),
      []
    );
  });
});

/**
 * DBCS を含む要素でも同じ規則が成り立つこと（2026-08-26 に実機で確定）。
 * 実機の "Expanded Source" が `'社員番号'` を `Field length = 10` と報告している。
 */
describe("DBCS 要素の隣接規則（実機で確定した値の回帰テスト）", () => {
  const dbcsConstant = (row: number): string =>
    ln({ row, col: 2, func: "'社員番号'" });

  test("DBCS 定数の占有幅は SO/SI 込みの 10 桁", () => {
    const doc = parse([ln({ rec: "T" }), dbcsConstant(3), ""].join("\n"));
    const item = doc.lines.find((l): l is ItemLine => l.kind === "item")!.item;
    assert.equal(itemWidth(item), 10);
  });

  for (const [col, expected] of [
    [10, true],
    [11, true],
    [12, true],
    [13, false]
  ] as const) {
    test(`DBCS 定数(2-11) の隣にフィールドを ${col} 桁目 → ${expected ? "違反" : "OK"}`, () => {
      const result = codes([
        dbcsConstant(3),
        ln({ name: "FLD1", len: 5, type: "A", usage: "O", row: 3, col })
      ]);
      if (expected) {
        assert.ok(
          result.length > 0,
          `${col} 桁目は違反のはずだが診断が出ていない`
        );
      } else {
        assert.deepEqual(result, []);
      }
    });
  }
});

describe("エラー級の違反", () => {
  test("画面の右端を越えると桁溢れ（エラー）", () => {
    const [diag] = diagnose([
      ln({ name: "FLDX", len: 10, type: "A", usage: "O", row: 3, col: 76 })
    ]);
    assert.equal(diag.code, DIAGNOSTIC_CODES.overflow);
    assert.equal(diag.severity, "error");
  });

  test("画面の行範囲を越えるとエラー", () => {
    const [diag] = diagnose([
      ln({ name: "FLDY", len: 5, type: "A", usage: "O", row: 25, col: 2 })
    ]);
    assert.equal(diag.code, DIAGNOSTIC_CODES.lineOutOfRange);
    assert.equal(diag.severity, "error");
  });
});

describe("重大度", () => {
  test("隣接違反は警告であってエラーではない（実機がコンパイルを通すため）", () => {
    const [diag] = diagnose([
      ln({ row: 3, col: 2, func: "'ABCDE'" }),
      ln({ name: "FLD1", len: 5, type: "A", usage: "O", row: 3, col: 7 })
    ]);
    assert.equal(diag.severity, "warning");
  });

  test("実データが重なっている場合は別コードで報告する（こちらも警告）", () => {
    const [diag] = diagnose([
      ln({ row: 3, col: 2, func: "'ABCDE'" }),
      ln({ name: "FLD1", len: 5, type: "A", usage: "O", row: 3, col: 4 })
    ]);
    assert.equal(diag.code, DIAGNOSTIC_CODES.overlap);
    assert.equal(diag.severity, "warning");
  });

  test("別の行なら隣接していても違反にならない", () => {
    assert.deepEqual(
      codes([
        ln({ row: 3, col: 2, func: "'ABCDE'" }),
        ln({ name: "FLD1", len: 5, type: "A", usage: "O", row: 4, col: 7 })
      ]),
      []
    );
  });
});

/**
 * 実機コンパイラとの差分検証（2026-08-26 実施）。
 *
 * 24 ケース（要素の種別 × SBCS/DBCS × 前後の順 × 隙間 0/1/2/3 桁）を生成して
 * 実機で `CRTDSPF` し、`CPD7866` の有無を我々の `validate` と突き合わせた結果、
 * **24 ケースすべてで一致**した（実機の警告 12 件 / 我々の判定 12 件、ケースも同一）。
 *
 * ここではその 24 ケースを表として固定し、規則が壊れたら気付けるようにする。
 * **実機で確認済みの期待値**であり、机上の想定ではない。
 */
describe("実機コンパイラとの差分検証（24 ケースの回帰）", () => {
  const first = {
    // 定数 'ABCDE' は 2-6 桁（a2 = 6）
    C5: (row: number) => ln({ row, col: 2, func: "'ABCDE'" }),
    // フィールド 5 桁も 2-6 桁
    F5: (row: number) => ln({ name: "FA", len: 5, type: "A", usage: "O", row, col: 2 }),
    // DBCS 定数 '社員番号' は SO/SI 込みで 2-11 桁（a2 = 11）
    D4: (row: number) => ln({ row, col: 2, func: "'社員番号'" })
  };
  const second = {
    c2: (row: number, col: number) => ln({ row, col, func: "'XY'" }),
    f5: (row: number, col: number) =>
      ln({ name: "FB", len: 5, type: "A", usage: "O", row, col })
  };

  for (const [firstTag, a2] of [["C5", 6], ["F5", 6], ["D4", 11]] as const) {
    for (const secondTag of ["c2", "f5"] as const) {
      for (const [offset, violates] of [
        [0, true],
        [1, true],
        [2, false],
        [3, false]
      ] as const) {
        const col = a2 + offset;
        test(`${firstTag} + ${secondTag} を ${col} 桁目（a2=${a2}）→ ${violates ? "違反" : "OK"}`, () => {
          const result = codes([first[firstTag](3), second[secondTag](3, col)]);
          if (violates) {
            assert.ok(result.length > 0, "実機は警告を出すのに診断が無い");
          } else {
            assert.deepEqual(result, [], "実機は警告を出さないのに診断が出ている");
          }
        });
      }
    }
  }
});

describe("幅を判定できない項目を知らせる（review should-1）", () => {
  test("参照フィールド（長さ無し）に警告が出る", () => {
    const [diag] = diagnose([
      ln({ name: "REFFLD", type: "A", usage: "O", row: 3, col: 2 })
    ]);
    assert.equal(diag.code, DIAGNOSTIC_CODES.widthUnknown);
    assert.equal(diag.severity, "warning");
    assert.ok(diag.message.includes("参照フィールド"));
  });

  test("キーワード駆動の項目（DATE 等）に警告が出る", () => {
    const [diag] = diagnose([ln({ row: 5, col: 2, func: "DATE EDTCDE(Y)" })]);
    assert.equal(diag.code, DIAGNOSTIC_CODES.widthUnknown);
    assert.ok(diag.message.includes("DATE"));
  });

  test("幅が判定できる項目には出ない", () => {
    assert.deepEqual(
      codes([ln({ name: "F1", len: 5, type: "A", usage: "O", row: 3, col: 2 })]),
      []
    );
  });
});
