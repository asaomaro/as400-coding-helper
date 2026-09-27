import * as assert from "assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildKeywordWithValues,
  missingKeywordValue,
  readKeywordValues,
  type KeywordValueSlot
} from "../../src/core/dds/ddsKeywordValues";
import { parseKeywordEntries } from "../../src/core/dds/ddsKeywords";

/**
 * キーワードの値を選んで書く（2026-09-27 利用者の依頼）。値の一覧は原典から生成したもの
 * （`docs/origin/generate-dds-keyword-values.mjs`）を使う。
 */
const tables = JSON.parse(
  readFileSync(join(__dirname, "../../../resources/completion/dds-keywords.json"), "utf8")
) as Record<string, Array<{ name: string; values?: KeywordValueSlot[] }>>;
const slotsOf = (type: string, name: string): readonly KeywordValueSlot[] => {
  const slots = tables[type].find(entry => entry.name === name)?.values;
  assert.ok(slots, `${type} ${name} に値の一覧が無い`);
  return slots;
};
const values = (slots: readonly KeywordValueSlot[], slot = 0) => slots[slot].choices.map(choice => choice.value);

suite("キーワードの値: 原典から生成した一覧", () => {
  test("画面の COLOR は原典の 7 色、DSPATR は複数選べる 11 属性", () => {
    assert.deepStrictEqual(values(slotsOf("DDS-DSPF", "COLOR")), ["GRN", "WHT", "RED", "TRQ", "YLW", "PNK", "BLU"]);
    const dspatr = slotsOf("DDS-DSPF", "DSPATR");
    assert.strictEqual(dspatr[0].multiple, true);
    assert.deepStrictEqual(values(dspatr), ["BL", "CS", "HI", "ND", "PC", "RI", "UL", "MDT", "OID", "PR", "SP"]);
  });
  test("帳票の COLOR は画面と別の集合（BLK / BRN があり WHT が無い）", () => {
    const colors = values(slotsOf("DDS-PRTF", "COLOR"));
    assert.ok(colors.includes("BLK") && colors.includes("BRN") && !colors.includes("WHT"));
  });
  test("画面の CHECK は原典の要約（妥当性検査・キーボード制御・カーソル制御）の全部", () => {
    assert.deepStrictEqual(values(slotsOf("DDS-DSPF", "CHECK")), [
      "AB", "ME", "MF", "M10", "M10F", "M11", "M11F", "VN", "VNE", "ER", "FE", "LC", "RB", "RZ", "RL", "RLTB"
    ]);
  });
  test("DATE は 2 つの位置（*JOB|*SYS と *Y|*YY）で、どちらも省ける", () => {
    const date = slotsOf("DDS-DSPF", "DATE");
    assert.deepStrictEqual(date.map(slot => [slot.optional, slot.choices.map(choice => choice.value)]), [
      [true, ["*JOB", "*SYS"]],
      [true, ["*Y", "*YY"]]
    ]);
  });
});

suite("キーワードの値: 読む・書く", () => {
  const dspatr = slotsOf("DDS-DSPF", "DSPATR");
  const color = slotsOf("DDS-DSPF", "COLOR");
  const date = slotsOf("DDS-DSPF", "DATE");
  const comp = slotsOf("DDS-DSPF", "COMP");
  const edtcde = slotsOf("DDS-DSPF", "EDTCDE");

  test("複数の値は一覧の順に書く（チェックした順に依らない）", () => {
    assert.strictEqual(buildKeywordWithValues("DSPATR", dspatr, [["RI", "HI"]]), "DSPATR(HI RI)");
  });

  test("今の引数を読む（小文字でも一覧の綴りにそろえる）", () => {
    assert.deepStrictEqual(readKeywordValues(dspatr, "hi ri"), [["HI", "RI"]]);
    assert.deepStrictEqual(readKeywordValues(color, "RED"), [["RED"]]);
  });

  test("省ける位置は飛ばして読む（DATE(*YY) は 2 番目の位置）", () => {
    assert.deepStrictEqual(readKeywordValues(date, "*YY"), [[], ["*YY"]]);
    assert.strictEqual(buildKeywordWithValues("DATE", date, [[], ["*YY"]]), "DATE(*YY)");
    assert.strictEqual(buildKeywordWithValues("DATE", date, [[], []]), "DATE");
  });

  test("一覧に無い値も書ける位置（COMP の比較する値、EDTCDE の通貨記号）", () => {
    assert.deepStrictEqual(readKeywordValues(comp, "GT 0"), [["GT"], ["0"]]);
    assert.deepStrictEqual(readKeywordValues(comp, "EQ 'A B'"), [["EQ"], ["'A B'"]]);
    assert.deepStrictEqual(readKeywordValues(edtcde, "J $"), [["J"], ["$"]]);
    assert.deepStrictEqual(readKeywordValues(edtcde, "Y"), [["Y"], []]);
  });

  test("一覧の形に読めないもの（P フィールド・一覧に無い値）は undefined（選ばせない）", () => {
    assert.strictEqual(readKeywordValues(dspatr, "&ATTR"), undefined);
    assert.strictEqual(readKeywordValues(color, "PURPLE"), undefined);
  });

  test("省けない位置が空なら書けない（COLOR() は実機が通さない）", () => {
    assert.strictEqual(missingKeywordValue(color, [[]]), 0);
    assert.strictEqual(missingKeywordValue(color, [["RED"]]), undefined);
    assert.strictEqual(missingKeywordValue(comp, [["GT"], []]), 1);
  });

  test("全部の値の一覧で、書いた形を読み戻すと同じ選択に戻る（往復）", () => {
    for (const [type, entries] of Object.entries(tables)) {
      for (const entry of entries) {
        if (entry.values === undefined) continue;
        const selection = entry.values.map(slot =>
          slot.choices.length === 0 ? ["X"] : slot.multiple ? slot.choices.slice(0, 2).map(c => c.value) : [slot.choices[0].value]
        );
        const written = buildKeywordWithValues(entry.name, entry.values, selection);
        const parsed = parseKeywordEntries(written)[0];
        assert.deepStrictEqual(readKeywordValues(entry.values, parsed.parameters), selection, `${type} ${entry.name}: ${written}`);
      }
    }
  });
});
