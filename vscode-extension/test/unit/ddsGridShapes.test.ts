import * as assert from "assert";
import {
  buildGrdbox,
  buildGrdlin,
  buildPrtfBox,
  buildPrtfLine,
  parseGrdbox,
  parseGrdlin,
  parsePrtfBox,
  parsePrtfLine,
  readGridShapes
} from "../../src/core/dds/ddsGridShapes";
import { DEFAULT_DENSITY } from "../../src/core/dds/prtfDensity";

/**
 * `build*` は `KEYWORD(...)` という完全な形の文字列を返す（`ddsEditWriteBack.ts` の
 * `buildRecordLine` 等と同じ、コード側に直接差し込める前提）。`parse*` が受け取るのは
 * `parseKeywordEntries` が既に切り出した**括弧の中身だけ**（外側の1組の括弧を除いたもの）
 * なので、往復を確かめるにはここで同じ形に戻す。
 */
const paramsOf = (built: string, keyword: string): string => built.slice(keyword.length + 1, -1);

/**
 * 罫線・枠のキーワード引数の読み書き。
 *
 * ## 期待値の出所
 *
 * DSPF（`GRDLIN`/`GRDBOX`）の構文・有効値は原典から直読
 * （`docs/origin/dds/detail/rzakc_rzakcmstdfgrd{l,b}.htm`。research.md F2）。
 * PRTF（`BOX`/`LINE`）は既存取得済みの原典から直読
 * （`docs/origin/dds/detail/rzakd_rzakdmstpt{box,line}.htm`。research.md F3）。
 */

suite("ddsGridShapes: GRDLIN（DSPF）", () => {
  test("*POS と *TYPE を読む", () => {
    const shape = parseGrdlin("(*POS 3 10 5)(*TYPE UPPER)");
    assert.deepStrictEqual(shape, { row: 3, column: 10, length: 5, edge: "upper" });
  });

  test("*TYPE 省略時は既定の upper（原典: タイプ・パラメーターのデフォルトは、upper です）", () => {
    const shape = parseGrdlin("(*POS 1 1 80)");
    assert.strictEqual(shape?.edge, "upper");
  });

  test("LOWER/RIGHT/LEFT も読める（原典の有効値）", () => {
    assert.strictEqual(parseGrdlin("(*POS 1 1 1)(*TYPE LOWER)")?.edge, "lower");
    assert.strictEqual(parseGrdlin("(*POS 1 1 1)(*TYPE RIGHT)")?.edge, "right");
    assert.strictEqual(parseGrdlin("(*POS 1 1 1)(*TYPE LEFT)")?.edge, "left");
  });

  test("*DS3/*DS4 の両方があれば target に一致する方を採る", () => {
    const params = "(*POS *DS3 3 10 5 *DS4 5 15 8)(*TYPE UPPER)";
    assert.deepStrictEqual(parseGrdlin(params, "primary"), {
      row: 3,
      column: 10,
      length: 5,
      edge: "upper"
    });
    assert.deepStrictEqual(parseGrdlin(params, "secondary"), {
      row: 5,
      column: 15,
      length: 8,
      edge: "upper"
    });
  });

  test("*DS3 だけなら secondary を頼んでもそれを使う（唯一の情報源）", () => {
    const shape = parseGrdlin("(*POS *DS3 3 10 5)(*TYPE UPPER)", "secondary");
    assert.deepStrictEqual(shape, { row: 3, column: 10, length: 5, edge: "upper" });
  });

  test("*POS が無ければ undefined", () => {
    assert.strictEqual(parseGrdlin("(*TYPE UPPER)"), undefined);
  });

  test("崩れた *DS3 組の後ろにある正しい *DS4 組を読み飛ばさない（review 指摘・回帰）", () => {
    // *DS3 の3値目が数値でない（壊れた入力）。壊れた組を無条件に読み飛ばすと、
    // 直後の正しい *DS4 組のマーカーごと通り過ぎてしまっていた。
    const shape = parseGrdlin("(*POS *DS3 3 10 *DS4 5 15 8)(*TYPE UPPER)", "secondary");
    assert.deepStrictEqual(shape, { row: 5, column: 15, length: 8, edge: "upper" });
  });

  test("buildGrdlin は parseGrdlin で読み戻せる（往復）", () => {
    const shape = { row: 4, column: 8, length: 12, edge: "left" as const };
    const built = buildGrdlin(shape);
    assert.ok(built.startsWith("GRDLIN("), built);
    assert.deepStrictEqual(parseGrdlin(paramsOf(built, "GRDLIN")), shape);
  });
});

suite("ddsGridShapes: GRDBOX（DSPF）", () => {
  test("*POS の4値（row column depth width）を読む", () => {
    const shape = parseGrdbox("(*POS 2 5 10 20)");
    assert.deepStrictEqual(shape, { row: 2, column: 5, depth: 10, width: 20 });
  });

  test("buildGrdbox は parseGrdbox で読み戻せる（往復）", () => {
    const shape = { row: 1, column: 1, depth: 5, width: 30 };
    const built = buildGrdbox(shape);
    assert.ok(built.startsWith("GRDBOX("), built);
    assert.deepStrictEqual(parseGrdbox(paramsOf(built, "GRDBOX")), shape);
  });

  test("0 以下の値は読めない（負の大きさは成立しない）", () => {
    assert.strictEqual(parseGrdbox("(*POS 1 1 0 5)"), undefined);
  });
});

suite("ddsGridShapes: readGridShapes（レコードのキーワード欄から複数拾う）", () => {
  test("GRDLIN と GRDBOX を両方拾い、無関係なキーワードは無視する", () => {
    const result = readGridShapes(
      "DSPATR(HI) GRDLIN((*POS 1 1 80)(*TYPE UPPER)) COLOR(BLU) GRDBOX((*POS 5 5 3 10))"
    );
    assert.strictEqual(result.lines.length, 1);
    assert.strictEqual(result.boxes.length, 1);
    assert.strictEqual(result.lines[0].row, 1);
    assert.strictEqual(result.boxes[0].row, 5);
  });

  test("罫線・枠が無ければ両方とも空", () => {
    const result = readGridShapes("DSPATR(HI) COLOR(BLU)");
    assert.deepStrictEqual(result, { lines: [], boxes: [] });
  });
});

suite("ddsGridShapes: BOX/LINE（PRTF・cm/inch との変換）", () => {
  // CPI 10 / LPI 6（CRTPRTF の既定。prtfDensity.ts DEFAULT_DENSITY と同じ）。
  const density = DEFAULT_DENSITY;

  test("原典の使用例（BOX(1.2 0.5 5.1 6.3 0.2)）をそのまま読める", () => {
    // 原典（rzakdmstptbox.htm）: "BOX(1.2 0.5 5.1 6.3 0.2)" — 単位はインチ既定。
    const shape = parsePrtfBox("1.2 0.5 5.1 6.3 0.2", density);
    assert.ok(shape);
    // 1.2インチ ≒ 7.2行(LPI6) → +1 で row=8、0.5インチ ≒ 5桁(CPI10) → +1 で column=6。
    assert.strictEqual(shape?.row, Math.round(1.2 * 6) + 1);
    assert.strictEqual(shape?.column, Math.round(0.5 * 10) + 1);
  });

  test("buildPrtfBox は parsePrtfBox で読み戻せる（往復・行桁の単位で一致）", () => {
    const shape = { row: 3, column: 5, depth: 4, width: 20 };
    const built = buildPrtfBox(shape, density);
    assert.ok(built.startsWith("BOX("), built);
    assert.deepStrictEqual(parsePrtfBox(paramsOf(built, "BOX"), density), shape);
  });

  test("原典の使用例（LINE(0.5 7.1 ...)）の位置だけ読める", () => {
    // 原典（rzakdmstptline.htm）: "LINE(0.5 7.1 … )"。方向・幅を補って検証する。
    const shape = parsePrtfLine("0.5 7.1 2.0 *HRZ 0.1", density);
    assert.ok(shape);
    assert.strictEqual(shape?.row, Math.round(0.5 * 6) + 1);
    assert.strictEqual(shape?.column, Math.round(7.1 * 10) + 1);
    assert.strictEqual(shape?.edge, "upper");
  });

  test("buildPrtfLine は parsePrtfLine で読み戻せる（水平・垂直とも往復）", () => {
    const horizontal = { row: 2, column: 1, length: 80, edge: "upper" as const };
    const builtH = buildPrtfLine(horizontal, density);
    assert.deepStrictEqual(parsePrtfLine(paramsOf(builtH, "LINE"), density), horizontal);

    const vertical = { row: 1, column: 40, length: 10, edge: "left" as const };
    const builtV = buildPrtfLine(vertical, density);
    assert.deepStrictEqual(parsePrtfLine(paramsOf(builtV, "LINE"), density), vertical);
  });

  test("*VRT/*HRZ 以外の方向は読めない", () => {
    assert.strictEqual(parsePrtfLine("1 1 5 *DIAG 0.1", density), undefined);
  });

  test("cm 単位（UOM *CM）でも一致する（2.54で相互変換）", () => {
    const shape = { row: 1, column: 1, depth: 3, width: 3 };
    const builtInch = buildPrtfBox(shape, density, "inch");
    const builtCm = buildPrtfBox(shape, density, "cm");
    assert.notStrictEqual(builtInch, builtCm);
    assert.deepStrictEqual(parsePrtfBox(paramsOf(builtCm, "BOX"), density, "cm"), shape);
  });
});
