import * as assert from "assert";
import {
  CPI_VALUES,
  DEFAULT_DENSITY,
  LPI_VALUES,
  paperInches,
  resolvePrintDensity
} from "../../src/core/dds/prtfDensity";
import { buildPrtfRenderModel } from "../../src/core/dds/prtfRenderModel";

/**
 * 帳票の印刷密度（CPI / LPI）。
 *
 * ## 期待値の出所
 *
 * 値の集合は**原典から生成**したもの（`docs/origin/generate-dds-print-density.mjs`）で、
 * `verify-dds-print-density.mjs` が原典の「キーワードの形式」と本文、
 * それに `CRTPRTF` の既定の 3 つが一致することまで見ている。
 *
 * 紙の大きさは原典の例で検算する——
 * > ページの長さが 66 行で、ファイルの LPI の値が 6 であるとすれば、用紙の長さは 11.0 インチです
 */

const put = (line: string, column: number, value: string): string => {
  const a = line.split("");
  for (let i = 0; i < value.length; i += 1) a[column - 1 + i] = value[i];
  return a.join("");
};
const A = () => put(" ".repeat(80), 6, "A");
const rec = (name: string, keywords = "") =>
  put(put(put(A(), 17, "R"), 19, name), 45, keywords).replace(/ +$/u, "");
const kwd = (keywords: string) => put(A(), 45, keywords).replace(/ +$/u, "");

suite("印刷密度: 値の集合", () => {
  test("CPI は原典の 10 / 15", () => {
    assert.deepStrictEqual([...CPI_VALUES], [10, 15]);
  });

  test("LPI は原典の 4 / 6 / 8 / 9 / 12", () => {
    assert.deepStrictEqual([...LPI_VALUES], [4, 6, 8, 9, 12]);
  });

  test("既定は CRTPRTF の既定（CPI 10 / LPI 6）", () => {
    assert.deepStrictEqual({ ...DEFAULT_DENSITY }, { cpi: 10, lpi: 6 });
  });
});

suite("印刷密度: ソースから読む", () => {
  test("書かれていなければ CRTPRTF の既定", () => {
    const density = resolvePrintDensity([rec("R1"), kwd("SPACEA(1)")]);
    assert.strictEqual(density.cpi, 10);
    assert.strictEqual(density.lpi, 6);
    assert.strictEqual(density.mixed, false);
    assert.deepStrictEqual(density.written, { cpi: [], lpi: [] });
  });

  test("書かれていればそれを使う", () => {
    const density = resolvePrintDensity([rec("R1", "CPI(15)"), kwd("LPI(8)")]);
    assert.strictEqual(density.cpi, 15);
    assert.strictEqual(density.lpi, 8);
  });

  test("**最初に書かれたものを採る**", () => {
    const density = resolvePrintDensity([rec("R1", "LPI(8)"), rec("R2", "LPI(12)")]);
    assert.strictEqual(density.lpi, 8);
  });

  test("**複数あることを知らせる**（黙って 1 つで描かない）", () => {
    const density = resolvePrintDensity([rec("R1", "LPI(8)"), rec("R2", "LPI(12)")]);
    assert.strictEqual(density.mixed, true);
    assert.deepStrictEqual([...density.written.lpi], [8, 12]);
  });

  test("原典に無い値は採らない（コンパイラが弾く）", () => {
    const density = resolvePrintDensity([rec("R1", "CPI(12)"), kwd("LPI(7)")]);
    assert.strictEqual(density.cpi, 10, "CPI(12) は原典に無い");
    assert.strictEqual(density.lpi, 6, "LPI(7) は原典に無い");
    assert.deepStrictEqual(density.written, { cpi: [], lpi: [] });
  });

  test("同じ値が 2 回書かれていても「複数」にしない", () => {
    const density = resolvePrintDensity([rec("R1", "LPI(8)"), rec("R2", "LPI(8)")]);
    assert.strictEqual(density.mixed, false);
  });

  test("他のキーワードの数値に反応しない", () => {
    const density = resolvePrintDensity([rec("R1", "SPACEA(15)"), kwd("SKIPB(8)")]);
    assert.deepStrictEqual({ cpi: density.cpi, lpi: density.lpi }, { cpi: 10, lpi: 6 });
  });
});

suite("印刷密度: 紙の大きさ", () => {
  test("**原典の例と一致する**（66 行 ÷ 6 LPI ＝ 11.0 インチ）", () => {
    const paper = paperInches({ rows: 66, columns: 132 }, { cpi: 10, lpi: 6 });
    assert.strictEqual(paper.height, 11);
    assert.strictEqual(paper.width, 13.2);
  });

  test("密度を上げると小さくなる", () => {
    const paper = paperInches({ rows: 66, columns: 132 }, { cpi: 15, lpi: 8 });
    assert.strictEqual(paper.width, 8.8);
    assert.strictEqual(paper.height, 8.25);
  });
});

suite("印刷密度: 描画モデルに載る", () => {
  test("帳票のモデルが密度を持つ", () => {
    const model = buildPrtfRenderModel([rec("R1", "CPI(15)"), kwd("LPI(8)")]);
    assert.deepStrictEqual(
      { cpi: model.density?.cpi, lpi: model.density?.lpi },
      { cpi: 15, lpi: 8 }
    );
  });

  test("書かれていなければ既定が載る", () => {
    const model = buildPrtfRenderModel([rec("R1")]);
    assert.deepStrictEqual(
      { cpi: model.density?.cpi, lpi: model.density?.lpi },
      { cpi: 10, lpi: 6 }
    );
  });
});
