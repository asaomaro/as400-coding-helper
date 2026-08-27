import * as assert from "assert";
import { validateDdsEdits, type DdsEdit } from "../../src/core/dds/ddsEdit";
import { resolveDspfLayout, isRowOneColumnOne } from "../../src/core/dds/dspfLayout";
import { resolvePrtfLayout } from "../../src/core/dds/prtfLayout";
import { lintFile } from "../../src/lint/engine";
import { defaultResourcesDir, loadDefinitions } from "../../src/lint/defsLoader";
import { join } from "node:path";

/**
 * **種別で答えが変わる検査。**
 *
 * `validateDdsEdits` は「ソースに書けるか」を見るが、そのうち 2 つは
 * 画面ファイルと帳票で答えが違う。種別は**必須の引数**にしてある
 * ——任意にすると渡し忘れた側で黙って検査が消える（AGENTS.md の配線漏れ）。
 *
 * ## 1 行 1 桁の規則は実機に判定させた
 *
 * 原典は「フィールドは、表示画面の最初の桁を占めることはできません」と書くが、
 * 続く例は**1 行 1 桁**を指している。実機で確かめると例のとおりだった
 * （2026-08-27 / IBM i 7.3）:
 *
 * | 位置 | `CRTDSPF` |
 * |---|---|
 * | 1 行 1 桁（定数・フィールドとも） | **通らない**（`CPF7311`） |
 * | 2 行 1 桁 | 通る |
 * | 1 行 2 桁 | 通る |
 *
 * 直す前は行を見ずに `column <= 1` で報告しており、**既定 ON の規則が
 * 実機で通るソースを誤検出していた**。
 */

const DSPF = [
  "     A          R MAIN",
  "     A            FLD1          10A  B  5  2",
  "     A                                  6  2'ラベル'"
];

/** 帳票。位置欄に行番号を書かず、行送りで決まる形（実務の PRTF）。 */
const PRTF = [
  "     A          R HEAD                     SKIPB(1)",
  "     A                                     2'見出し'"
];

function codes(
  lines: readonly string[],
  edit: DdsEdit,
  ddsType: "DDS-DSPF" | "DDS-PRTF"
): string[] {
  return validateDdsEdits(lines, [edit], ddsType).map(rejection => rejection.code);
}

suite("種別で変わる検査: 1 行 1 桁", () => {
  test("判定は行と桁の両方を見る", () => {
    assert.strictEqual(isRowOneColumnOne(1, 1), true);
    assert.strictEqual(isRowOneColumnOne(2, 1), false, "2 行 1 桁は実機が通す");
    assert.strictEqual(isRowOneColumnOne(1, 2), false, "1 行 2 桁は実機が通す");
  });

  test("画面ファイルでは 1 行 1 桁への移動を断る", () => {
    assert.deepStrictEqual(
      codes(DSPF, { kind: "move", sourceLine: 2, row: 1, column: 1 }, "DDS-DSPF"),
      ["column-one-reserved"]
    );
  });

  test("2 行以降の 1 桁目は通す（属性文字は前の行の 80 桁目）", () => {
    assert.deepStrictEqual(
      codes(DSPF, { kind: "move", sourceLine: 2, row: 2, column: 1 }, "DDS-DSPF"),
      []
    );
  });

  test("1 行 2 桁も通す", () => {
    assert.deepStrictEqual(
      codes(DSPF, { kind: "move", sourceLine: 2, row: 1, column: 2 }, "DDS-DSPF"),
      []
    );
  });

  test("帳票では 1 行 1 桁も通す（属性文字が無い）", () => {
    assert.deepStrictEqual(
      codes(DSPF, { kind: "move", sourceLine: 2, row: 1, column: 1 }, "DDS-PRTF"),
      []
    );
  });

  test("追加からも入れない（移動だけ塞いでも同じ状態になる）", () => {
    assert.deepStrictEqual(
      codes(
        DSPF,
        {
          kind: "add",
          recordName: "MAIN",
          item: { kind: "constant", text: "x", row: 1, column: 1 }
        },
        "DDS-DSPF"
      ),
      ["column-one-reserved"]
    );
  });

  test("桁だけの移動でも、いまの行が 1 なら断る", () => {
    const atRowOne = [
      "     A          R MAIN",
      "     A                                  1  5'ラベル'"
    ];
    assert.deepStrictEqual(
      codes(atRowOne, { kind: "moveColumn", sourceLine: 2, column: 1 }, "DDS-DSPF"),
      ["column-one-reserved"]
    );
  });
});

suite("種別で変わる検査: 描画の指摘", () => {
  test("1 行 1 桁だけを指摘する", () => {
    const at = (row: number, column: number) =>
      resolveDspfLayout([
        "     A          R T",
        `     A                                ${String(row).padStart(3)}${String(column).padStart(3)}'X'`
      ]).diagnostics.map(diagnostic => diagnostic.code);

    assert.deepStrictEqual(at(1, 1), ["column-one-reserved"]);
    assert.deepStrictEqual(at(2, 1), [], "2 行 1 桁を誤検出している");
    assert.deepStrictEqual(at(1, 2), [], "1 行 2 桁を誤検出している");
    assert.deepStrictEqual(at(12, 1), [], "12 行 1 桁を誤検出している");
  });

  /**
   * `layout-column-one-reserved` は**既定 ON・error**。誤検出は
   * 「正しいソースが CI で落ちる」に直結するので、lint 経路でも見ておく。
   */
  test("lint も 2 行以降の 1 桁目を指摘しない", () => {
    const definitions = loadDefinitions(defaultResourcesDir(join(__dirname, "..", "..", "src")));
    const findings = lintFile({
      fsPath: "/tmp/x.dspf",
      lines: ["     A          R T", "     A                                  5  1'X'"],
      definitions,
      options: { enabledRules: ["layout-column-one-reserved"] }
    });
    assert.deepStrictEqual(findings, [], "実機で通るソースを指摘している");
  });
});

suite("種別で変わる検査: 行送り", () => {
  /**
   * `row-from-spacing` は帳票の話。**画面ファイルには `SPACE` / `SKIP` が無い**ので、
   * 種別を見ないと意味を成さない理由（「行送りで決まります」）を返すことになる。
   */
  test("帳票では行を変える移動を断る", () => {
    assert.deepStrictEqual(
      codes(PRTF, { kind: "move", sourceLine: 2, row: 5, column: 10 }, "DDS-PRTF"),
      ["row-from-spacing"]
    );
  });

  test("帳票でも桁だけなら通す", () => {
    assert.deepStrictEqual(
      codes(PRTF, { kind: "moveColumn", sourceLine: 2, column: 10 }, "DDS-PRTF"),
      []
    );
  });

  test("画面ファイルでは行送りを理由にしない", () => {
    // 位置欄の行が空の項目（画面ファイルではそもそも配置されない）。
    const noRow = ["     A          R MAIN", "     A                                     2'ラベル'"];
    assert.deepStrictEqual(
      codes(noRow, { kind: "move", sourceLine: 2, row: 5, column: 10 }, "DDS-DSPF"),
      []
    );
    // 帳票なら同じ形が断られる（種別だけが違いを生んでいることの裏取り）。
    assert.deepStrictEqual(
      codes(noRow, { kind: "move", sourceLine: 2, row: 5, column: 10 }, "DDS-PRTF"),
      ["row-from-spacing"]
    );
  });

  /**
   * 帳票の診断コードの集合に `column-one-reserved` は**そもそも無い**（型で保証されている）。
   * ここで見るのは、1 行 1 桁の項目が指摘なしで配置されること。
   */
  test("帳票は 1 行 1 桁でも指摘なしで配置する", () => {
    const layout = resolvePrtfLayout([
      "     A          R T",
      "     A                                  1  1'X'"
    ]);
    assert.deepStrictEqual(layout.diagnostics, []);
    assert.strictEqual(layout.items.length, 1, "配置されていない");
    assert.strictEqual(layout.items[0].column, 1);
  });
});
