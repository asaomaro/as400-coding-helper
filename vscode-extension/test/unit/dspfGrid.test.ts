import * as assert from "assert";
import { resolveDspfLayout } from "../../src/core/dds/dspfLayout";
import { applyIndicators, buildDspfRenderModel } from "../../src/core/dds/dspfRenderModel";
import { buildKeywordLine, foldKeywordArea } from "../../src/core/dds/ddsEditWriteBack";

/**
 * 画面の罫線（`GRDBOX` / `GRDLIN`）。期待値は原典
 * `docs/origin/dds/detail/rzakc_rzakcmstdfgrd{b,l,a}.htm` の例と説明から写した。
 */

const record = (name: string, keywords = "") => `     A          R ${name}`.padEnd(44) + keywords;
/** キーワードだけの行。80 桁を超えるものは `-` 継続で折る（実機と同じ形）。条件は代表行に付ける。 */
const keyword = (keywords: string, conditioning = ""): string => {
  const [first, ...rest] = foldKeywordArea(keywords).map(area => buildKeywordLine(area));
  return [`     A${conditioning.padEnd(38)}${first.slice(44)}`, ...rest].join("\n");
};
const source = (...lines: string[]) => lines.join("\n").split("\n");

suite("DSPF: 罫線（GRDBOX / GRDLIN）", () => {
  test("GRDLIN RIGHT 4 15 は桁 6・21・36・51 の右境界に 20 行の縦線（原典の例）", () => {
    const { gridLines } = resolveDspfLayout(source(
      keyword("DSPSIZ(*DS3 *DS4)"),
      record("GRDREC1", "GRDRCD"),
      keyword("GRDLIN((*POS (*DS3 4 6 20) (*DS4 4 6 22)) (*TYPE RIGHT 4 15))")
    ));
    assert.deepStrictEqual(
      gridLines.map(line => [line.orientation, line.at, line.from, line.to]),
      [6, 21, 36, 51].map(column => ["vertical", column, 3, 23])
    );
  });

  test("GRDLIN LOWER 3 6 は行 8・14・20 の下の境界（原典の例）", () => {
    const { gridLines } = resolveDspfLayout(source(
      record("R1", "GRDRCD"),
      keyword("GRDLIN((*POS (8 1 80)) (*TYPE LOWER 3 6))")
    ));
    assert.deepStrictEqual(gridLines.map(line => [line.orientation, line.at]), [
      ["horizontal", 8],
      ["horizontal", 14],
      ["horizontal", 20]
    ]);
  });

  test("*TYPE の既定は UPPER（1 本・行の上の境界）", () => {
    const { gridLines } = resolveDspfLayout(source(record("R1", "GRDRCD"), keyword("GRDLIN((*POS (6 4 20)))")));
    assert.deepStrictEqual(gridLines.map(line => [line.orientation, line.at, line.from, line.to]), [["horizontal", 5, 3, 23]]);
  });

  test("GRDBOX は 4 辺。VRT で幅 21・罫線 3 なら縦線が 6 本（原典）", () => {
    const { gridLines } = resolveDspfLayout(source(
      record("R1", "GRDRCD"),
      keyword("GRDBOX((*POS (2 5 10 21)) (*TYPE VRT 3))")
    ));
    const vertical = gridLines.filter(line => line.orientation === "vertical").map(line => line.at);
    // 左右の辺（4・25）と、その間の 6 本。
    assert.deepStrictEqual(vertical, [4, 25, 7, 10, 13, 16, 19, 22]);
    const horizontal = gridLines.filter(line => line.orientation === "horizontal").map(line => line.at);
    assert.deepStrictEqual(horizontal, [1, 11]);
  });

  test("HRZVRT は横・縦の両方の罫線", () => {
    const { gridLines } = resolveDspfLayout(source(
      record("R1", "GRDRCD"),
      keyword("GRDBOX((*POS (1 1 4 6)) (*TYPE HRZVRT 2 3))")
    ));
    assert.strictEqual(gridLines.length, 4 + 1 + 1);
  });

  test("色と線種: GRDBOX/GRDLIN ＞ 様式の GRDATR ＞ ファイルの GRDATR ＞ 白・実線（原典 GRDATR の例）", () => {
    const { gridLines } = resolveDspfLayout(source(
      keyword("GRDATR((*COLOR WHT) (LINTYP SLD))"),
      record("GRDREC1", "GRDRCD"),
      keyword("GRDATR((*COLOR BLU) (LINTYP DSH))"),
      keyword("GRDBOX((*POS (2 2 10 70)) (*TYPE PLAIN))"),
      record("GRDREC2", "GRDRCD"),
      keyword("GRDBOX((*POS (4 4 5 45)) (*TYPE PLAIN))"),
      keyword("GRDLIN((*POS (6 4 20)) (*TYPE LOWER) (*COLOR RED) (*LINTYP DBL))")
    ));
    const of = (name: string) => gridLines.filter(line => line.recordName === name).map(line => `${line.color} ${line.lineType}`);
    assert.deepStrictEqual(of("GRDREC1"), Array(4).fill("BLU DSH"), "青の破線");
    // GRDREC2: 箱の 4 辺は白の実線、GRDLIN の 1 本は赤の二重線。
    assert.deepStrictEqual(of("GRDREC2"), [...Array(4).fill("WHT SLD"), "RED DBL"]);
  });

  test("*POS が P フィールドのものは描かない（実行時に決まる）", () => {
    const { gridLines } = resolveDspfLayout(source(
      record("R1", "GRDRCD"),
      keyword("GRDBOX((*POS (&SROW &SCOL 5 10)) (*TYPE PLAIN))")
    ));
    assert.deepStrictEqual(gridLines, []);
  });

  test("条件の付いた罫線は、標識をオフにすると消える", () => {
    const model = buildDspfRenderModel(source(
      record("R1", "GRDRCD"),
      keyword("GRDLIN((*POS (6 4 20)))", "  95")
    ));
    assert.strictEqual(model.gridShapes?.length, 1);
    assert.strictEqual(applyIndicators(model, { "95": "off" }).gridShapes?.length, 0);
    assert.strictEqual(applyIndicators(model, { "95": "on" }).gridShapes?.length, 1);
  });
});
