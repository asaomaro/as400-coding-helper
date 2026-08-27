import * as assert from "assert";
import {
  applyDdsEdits,
  validateDdsEdits
} from "../../src/core/dds/ddsEdit";
import {
  joinContinuations,
  startsContinuation,
  toLogicalUnits
} from "../../src/core/dds/ddsLogicalUnits";
import { buildDspfRenderModel } from "../../src/core/dds/dspfRenderModel";

/**
 * キーワード欄（45-80 桁）の継続。
 *
 * ## 期待値の出所は**実機**
 *
 * ローカルの原典スナップショットに継続規則のページが無いため、
 * IBM i 7.3（`5770SS1 V7R3M0`）の DDS コンパイラに判定させた（2026-08-27）。
 * `CRTDSPF` のリストの `Expanded Source` には**解決後の定数が長さつき**で出るので、
 * そこに出た値をそのまま期待値にしてある。
 *
 * | ソース | 実機の Expanded Source |
 * |---|---|
 * | `'ABC-` / `   DEF'` | `'ABC   DEF'` |
 * | `'ABC+` / `   DEF'` | `'ABCDEF'` |
 * | `'ABC` / (50 桁目)`DEF'` | `'ABC DEF'`（長さ 7） |
 * | `'AAA-` / `BBB-` / `CCC'` | `'AAABBBCCC'`（長さ 9） |
 * | `'XYZ'` / `COLOR(-` / `RED)` | `'XYZ' COLOR(RED)` |
 */

const put = (line: string, column: number, value: string): string => {
  const a = line.split("");
  for (let i = 0; i < value.length; i += 1) a[column - 1 + i] = value[i];
  return a.join("");
};
const blank = () => " ".repeat(80);
const A = () => put(blank(), 6, "A");
/** 45 桁目から機能欄を書いた行。 */
const fn = (text: string, column = 45) => put(A(), column, text).replace(/ +$/u, "");
/** 位置つきの定数行。 */
const cst = (row: number, column: number, text: string) =>
  put(put(put(A(), 39, String(row).padStart(3)), 42, String(column).padStart(3)), 45, text)
    .replace(/ +$/u, "");
const rec = (name: string) => put(put(A(), 17, "R"), 19, name).replace(/ +$/u, "");

const joined = (...lines: string[]) => joinContinuations(lines).map(j => j.keywords);

suite("継続: 実機の規則どおりに結合する", () => {
  test("`-` は空白を挟まず、継続行の 45 桁目ちょうどから続く", () => {
    assert.deepStrictEqual(joined(fn("'ABC-"), fn("   DEF'")), ["'ABC   DEF'"]);
  });

  test("`+` は継続行の先頭の空白を捨てて続く", () => {
    assert.deepStrictEqual(joined(fn("'ABC+"), fn("   DEF'")), ["'ABCDEF'"]);
  });

  test("継続記号なし（引用符が開いたまま）は空白 1 つを挟む", () => {
    assert.deepStrictEqual(joined(fn("'ABC"), fn("DEF'", 50)), ["'ABC DEF'"]);
  });

  test("3 行以上に連鎖する", () => {
    assert.deepStrictEqual(joined(fn("'AAA-"), fn("BBB-"), fn("CCC'")), ["'AAABBBCCC'"]);
  });

  test("リテラルの外でも切れる（括弧の途中）", () => {
    assert.deepStrictEqual(joined(fn("COLOR(-"), fn("RED)")), ["COLOR(RED)"]);
  });

  test("`-` と `+` は引用符が開いていても優先される", () => {
    // `'ABC-` は引用符が開いた状態で `-` で終わる。実機は `-` を継続記号として扱う。
    assert.deepStrictEqual(joined(fn("'ABC-"), fn("DEF'")), ["'ABCDEF'"]);
  });

  test("`''` はエスケープなので、そこで引用符は閉じない", () => {
    assert.deepStrictEqual(joined(fn("'A''B"), fn("C'")), ["'A''B C'"]);
  });

  test("継続していない行はそのまま（1 行 1 件）", () => {
    assert.deepStrictEqual(joined(fn("OVERLAY"), fn("PRINT")), ["OVERLAY", "PRINT"]);
  });

  test("注記行が挟まったら継続は切れる", () => {
    const comment = put(A(), 7, "*").replace(/ +$/u, "");
    assert.deepStrictEqual(joined(fn("'ABC-"), comment, fn("DEF'")), ["'ABC-", "", "DEF'"]);
  });

  test("次の行が無ければ継続記号を捨てない（書いたのに消えた、を作らない）", () => {
    assert.deepStrictEqual(joined(fn("'ABC-")), ["'ABC-"]);
  });

  test("機能欄が空の行は継続に使わない（条件付けだけの行を吸い込まない）", () => {
    // 条件付けだけの行は**次の単位への前置き**。吸い込むと条件が次の項目に付かなくなる。
    const conditioning = put(A(), 9, "01").replace(/ +$/u, "");
    assert.deepStrictEqual(joined(fn("'ABC-"), conditioning), ["'ABC-", ""]);
  });

  test("継続に使った行は sourceLines に入る", () => {
    const all = joinContinuations([fn("'AAA-"), fn("BBB-"), fn("CCC'"), fn("OVERLAY")]);
    assert.deepStrictEqual(all.map(j => j.sourceLines), [[1, 2, 3], [4]]);
  });

  test("startsContinuation は次行へ続く行だけ true", () => {
    assert.strictEqual(startsContinuation(fn("'ABC-")), true);
    assert.strictEqual(startsContinuation(fn("'ABC+")), true);
    assert.strictEqual(startsContinuation(fn("'ABC")), true);
    assert.strictEqual(startsContinuation(fn("'ABC'")), false);
    assert.strictEqual(startsContinuation(fn("OVERLAY")), false);
  });
});

suite("継続: 項目として認識される", () => {
  // 実機で通る DSPF。継続を知らないと、定数が丸ごと消えていた。
  const SOURCE = [
    rec("KWR"),
    cst(3, 12, "'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123+"),
    fn("456789'"),
    cst(5, 12, "'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123-"),
    fn("456789'"),
    cst(7, 12, "'ABCDEFGHIJ"),
    fn("KLMNOP'"),
    cst(9, 12, "'XYZ'"),
    fn("COLOR(-"),
    fn("RED)")
  ];

  test("**継続を含む定数もキャンバスに出る**", () => {
    const model = buildDspfRenderModel(SOURCE);
    assert.deepStrictEqual(
      model.items.map(item => [item.sourceLine, item.label]),
      [
        [2, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"],
        [4, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"],
        [6, "ABCDEFGHIJ KLMNOP"],
        [8, "XYZ"]
      ]
    );
  });

  test("別行のキーワードは従来どおり空白 1 つで足される", () => {
    const model = buildDspfRenderModel(SOURCE);
    const item = model.outline.flatMap(r => r.items).find(i => i.sourceLine === 8);
    assert.strictEqual(item?.attributes.keywords, "'XYZ' COLOR(RED)");
  });

  test("削除は継続行ごと消える", () => {
    const results = applyDdsEdits(SOURCE, [{ kind: "remove", sourceLine: 2 }]);
    assert.strictEqual(results.length, 1, JSON.stringify(results));
    // 範囲は 0 始まりの半開区間。[1, 3) ＝ 2 行目（代表行）と 3 行目（継続行）。
    assert.strictEqual(results[0].replaceFrom, 1);
    assert.strictEqual(results[0].replaceTo, 3);
    assert.deepStrictEqual(results[0].lines, []);
  });
});

suite("継続: 書き換えは拒否する", () => {
  const SOURCE = [
    rec("KWR"),
    cst(3, 12, "'ABC-"),
    fn("DEF'"),
    cst(5, 12, "'PLAIN'"),
    fn("DSPATR(HI)")
  ];

  test("継続にまたがる定数の文字列は拒否する", () => {
    const rejections = validateDdsEdits(SOURCE, [
      { kind: "setAttributes", sourceLine: 2, attributes: { text: "NEW" } }
    ]);
    assert.deepStrictEqual(rejections.map(r => r.code), ["keyword-continuation"]);
  });

  test("位置の変更は拒否しない（代表行の桁しか触らない）", () => {
    assert.deepStrictEqual(
      validateDdsEdits(SOURCE, [{ kind: "move", sourceLine: 2, row: 4, column: 12 }]),
      []
    );
  });

  test("**別行のキーワードを持つだけの定数は拒否しない**", () => {
    // `DSPATR(HI)` は継続ではない。代表行の欄を書き換えてもその行は壊れない。
    assert.deepStrictEqual(
      validateDdsEdits(SOURCE, [
        { kind: "setAttributes", sourceLine: 4, attributes: { text: "NEW" } }
      ]),
      []
    );
  });
});
