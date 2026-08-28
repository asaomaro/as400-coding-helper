import * as assert from "assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyDdsLine,
  fileLevelKeywordLines,
  toLogicalUnits
} from "../../src/core/dds/ddsLogicalUnits";
import { buildDspfRenderModel } from "../../src/core/dds/dspfRenderModel";
import {
  applyDdsEdits,
  validateDdsEdits,
  type DdsEdit
} from "../../src/core/dds/ddsEdit";
import { buildPrtfRenderModel } from "../../src/core/dds/prtfRenderModel";

/**
 * **ファイル・レベルのキーワード**（`DSPSIZ` / `REF` / `INDARA` / `PRINT` など）。
 *
 * 最初の様式より前に書かれるので `toLogicalUnits` は論理単位にしない
 * （置けるものではないため）。結果、一覧にもプロパティにも出ず、
 * **デザイナからは一切読めなかった**——`CUSTMNT.dspf` ではキーワード行 8 本のうち
 * 4 本がこれにあたる。
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const CUSTMNT = readFileSync(join(ROOT, "docs", "src", "CUSTMNT.dspf"), "utf8").split(/\r?\n/u);
const CUSTRPT = readFileSync(join(ROOT, "docs", "src", "CUSTRPT.prtf"), "utf8").split(/\r?\n/u);

suite("ファイル・レベルのキーワード: 読み取り", () => {
  test("実物から 4 本読める（CUSTMNT.dspf）", () => {
    assert.deepStrictEqual(
      fileLevelKeywordLines(CUSTMNT).map(entry => entry.keywords),
      ["DSPSIZ(24 80 *DS3)", "REF(CUSTMST)", "INDARA", "PRINT"]
    );
  });

  test("行番号が付く", () => {
    assert.deepStrictEqual(
      fileLevelKeywordLines(CUSTMNT).map(entry => entry.sourceLine),
      [2, 3, 4, 5]
    );
  });

  test("帳票でも読める", () => {
    assert.deepStrictEqual(
      fileLevelKeywordLines(CUSTRPT).map(entry => entry.keywords),
      ["REF(CUSTMST)"]
    );
  });

  /** **最初の様式より前だけ。** 様式のキーワードを巻き込まない。 */
  test("最初の様式で止まる", () => {
    const lines = [
      "     A                                      DSPSIZ(24 80 *DS3)",
      "     A          R MAIN                      OVERLAY",
      "     A                                      CA03(03)"
    ];
    assert.deepStrictEqual(
      fileLevelKeywordLines(lines).map(entry => entry.keywords),
      ["DSPSIZ(24 80 *DS3)"]
    );
  });

  /** 様式より前に項目があるソース（本来は不正）でも、そこで止まる。 */
  test("最初の項目でも止まる", () => {
    const lines = [
      "     A                                      REF(X)",
      "     A                                  1  2'見出し'",
      "     A                                      PRINT"
    ];
    assert.deepStrictEqual(
      fileLevelKeywordLines(lines).map(entry => entry.keywords),
      ["REF(X)"]
    );
  });

  test("注記行と空行は飛ばす", () => {
    const lines = [
      "     A* 注記",
      "",
      "     A                                      INDARA",
      "     A          R MAIN"
    ];
    assert.deepStrictEqual(
      fileLevelKeywordLines(lines).map(entry => entry.keywords),
      ["INDARA"]
    );
  });

  test("ファイル・レベルでも条件は読める", () => {
    const lines = [
      "     A  50                                  PRINT",
      "     A          R MAIN"
    ];
    const entries = fileLevelKeywordLines(lines);
    assert.strictEqual(entries.length, 1);
    assert.deepStrictEqual(entries[0].conditioningLines, [lines[0]]);
  });

  test("無ければ空", () => {
    assert.deepStrictEqual(fileLevelKeywordLines(["     A          R MAIN"]), []);
  });
});

suite("ファイル・レベルのキーワード: 分類の規則は 1 か所", () => {
  /**
   * `toLogicalUnits` と `fileLevelKeywordLines` が**同じ分類**を使うこと。
   * 食い違うと、同じ行が片方では様式・片方ではキーワードとして扱われる。
   */
  test("様式・項目・条件・キーワードを見分ける", () => {
    assert.strictEqual(classifyDdsLine("     A          R MAIN", ""), "record");
    assert.strictEqual(classifyDdsLine("     A            FLD1", ""), "item");
    // 定数（名前欄は空で、機能欄がリテラルで始まる）。
    assert.strictEqual(
      classifyDdsLine("     A                                  1  2'X'", "'X'"),
      "item"
    );
    assert.strictEqual(classifyDdsLine("     A  50", ""), "conditioning");
    assert.strictEqual(
      classifyDdsLine("     A                                      PRINT", "PRINT"),
      "keywords"
    );
    assert.strictEqual(classifyDdsLine("     A* 注記", ""), "none");
    assert.strictEqual(classifyDdsLine("", ""), "none");
    // 7-80 桁に何も無い行は空行。**生の行で見る**（機能欄は継続を解いた後のものなので、
    // 空行に中身が付くことは無い）。
    assert.strictEqual(classifyDdsLine("     A", ""), "none");
  });

  /** 論理単位の側は今までどおり（ファイル・レベルの行は単位にならない）。 */
  test("ファイル・レベルの行は論理単位にならない", () => {
    const units = toLogicalUnits(CUSTMNT);
    for (const sourceLine of [2, 3, 4, 5]) {
      assert.ok(
        !units.some(unit => unit.sourceLines.includes(sourceLine)),
        `${sourceLine} 行目が単位に入っている`
      );
    }
  });
});

suite("ファイル・レベルのキーワード: モデルに載る", () => {
  test("画面ファイルのモデルに載る", () => {
    const model = buildDspfRenderModel(CUSTMNT);
    assert.deepStrictEqual(
      model.fileKeywords.map(entry => entry.keywords),
      ["DSPSIZ(24 80 *DS3)", "REF(CUSTMST)", "INDARA", "PRINT"]
    );
    assert.strictEqual(model.fileKeywords[0].condition.kind, "none");
  });

  test("帳票のモデルにも載る", () => {
    const model = buildPrtfRenderModel(CUSTRPT);
    assert.deepStrictEqual(
      model.fileKeywords.map(entry => entry.keywords),
      ["REF(CUSTMST)"]
    );
  });

  /** 一覧（様式ごと）とは**別に持つ**——様式に属さないので入れる場所が無い。 */
  test("一覧には入らない", () => {
    const model = buildDspfRenderModel(CUSTMNT);
    for (const record of model.outline) {
      for (const item of record.items) {
        assert.ok(item.sourceLine > 5, `${item.sourceLine} 行目が一覧に混ざっている`);
      }
    }
  });
});

suite("ファイル・レベルのキーワード: 編集", () => {
  /**
   * **宛先は論理単位ではない。** ファイル・レベルの行は単位にならないので、
   * `ddsEdit` が生の行から別に引く。引けないと `line-not-found` で断られていた。
   */
  const apply = (lines: readonly string[], edits: readonly DdsEdit[]): string[] => {
    assert.deepStrictEqual(validateDdsEdits(lines, edits, "DDS-DSPF"), [], "検証で弾かれた");
    const out = [...lines];
    for (const result of [...applyDdsEdits(lines, edits, "DDS-DSPF")].sort(
      (a, b) => b.replaceFrom - a.replaceFrom
    )) {
      out.splice(result.replaceFrom, result.replaceTo - result.replaceFrom, ...result.lines);
    }
    return out;
  };

  test("ファイル・レベルの行を書き換えられる", () => {
    const after = apply(CUSTMNT, [
      { kind: "setKeywords", sourceLine: 4, keywords: "INDARA PRINT" }
    ]);
    assert.strictEqual(after.length, CUSTMNT.length, "行数が変わった");
    assert.ok(after[3].includes("INDARA PRINT"));
    assert.deepStrictEqual(
      fileLevelKeywordLines(after).map(entry => entry.keywords),
      ["DSPSIZ(24 80 *DS3)", "REF(CUSTMST)", "INDARA PRINT", "PRINT"],
      "読み戻せない"
    );
  });

  test("他のファイル・レベル行を巻き込まない", () => {
    const after = apply(CUSTMNT, [
      { kind: "setKeywords", sourceLine: 4, keywords: "INDARA PRINT" }
    ]);
    for (const index of [0, 1, 2, 4, 5]) {
      assert.strictEqual(after[index], CUSTMNT[index], `${index + 1} 行目が変わっている`);
    }
  });

  test("36 桁を超えれば折る（項目のときと同じ経路）", () => {
    const long = "REF(VERYLONGLIBRARY/VERYLONGFILENAME) INDARA PRINT";
    const after = apply(CUSTMNT, [{ kind: "setKeywords", sourceLine: 3, keywords: long }]);
    assert.ok(after.length > CUSTMNT.length, "折れていない");
    assert.deepStrictEqual(
      fileLevelKeywordLines(after).find(entry => entry.sourceLine === 3)?.keywords,
      long,
      "折った結果が読み戻せない"
    );
  });

  test("様式のキーワードは今までどおり書き換えられる", () => {
    const record = toLogicalUnits(CUSTMNT).find(unit => unit.kind === "record");
    assert.ok(record);
    const after = apply(CUSTMNT, [
      { kind: "setKeywords", sourceLine: record.sourceLine, keywords: "OVERLAY" }
    ]);
    assert.ok(after[record.sourceLine - 1].includes("OVERLAY"));
  });
});
