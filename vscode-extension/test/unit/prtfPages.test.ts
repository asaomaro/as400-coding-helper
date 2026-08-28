import * as assert from "assert";
import { resolvePrtfLayout } from "../../src/core/dds/prtfLayout";
import { buildPrtfRenderModel, selectPrintPage } from "../../src/core/dds/prtfRenderModel";

/**
 * **複数ページの帳票と、ページの途中で変わる LPI。**
 *
 * 規定は `SKIPB` のページではなく **`LPI` のページ**にある
 * （`docs/origin/dds/detail/rzakd_rzakdmstptlpi.htm`）:
 *
 * > データは、**行番号ではなく位置に基づいて**順次に処理されます。ある行番号への
 * > スキップを指定した場合に、それが**現在位置より前の位置**であれば
 * > (**たとえその行番号が現在の行番号より大きくても**)、**改ページが生じます**。
 *
 * 同じページの計算例をそのままテストにしてある（下の「原典の例」）。
 */

/** 桁は手で数えない。 */
const put = (line: string, column: number, value: string): string => {
  const chars = line.padEnd(80, " ").split("");
  for (let i = 0; i < value.length; i += 1) chars[column - 1 + i] = value[i];
  return chars.join("").replace(/ +$/u, "");
};
const blank = (): string => put(" ".repeat(80), 6, "A");
const record = (name: string, keywords = ""): string => {
  const line = put(put(blank(), 17, "R"), 19, name);
  return keywords ? put(line, 45, keywords) : line;
};
const keywordLine = (keywords: string): string => put(blank(), 45, keywords);
const constant = (col: number, text: string): string =>
  put(put(blank(), 42, String(col).padStart(3)), 45, `'${text}'`);

const at = (layout: ReturnType<typeof resolvePrtfLayout>, label: string) => {
  const item = layout.items.find(candidate => candidate.text === label);
  assert.ok(item, `${label} が置かれていない`);
  return item;
};

suite("帳票のページ: 後戻りするスキップ", () => {
  test("前に進むスキップは同じページ", () => {
    const layout = resolvePrtfLayout([
      record("R1", "SKIPB(5)"),
      constant(5, "AAA"),
      record("R2", "SKIPB(40)"),
      constant(5, "BBB")
    ]);
    assert.strictEqual(layout.pages, 1);
    assert.strictEqual(at(layout, "AAA").page, 1);
    assert.strictEqual(at(layout, "BBB").page, 1);
    assert.strictEqual(at(layout, "BBB").row, 40);
  });

  /** 原典: 「現在位置より前の位置であれば…改ページが生じます」 */
  test("**後戻りするスキップは改ページになる**", () => {
    const layout = resolvePrtfLayout([
      record("R1", "SKIPB(40)"),
      constant(5, "AAA"),
      record("R2", "SKIPB(3)"),
      constant(5, "BBB")
    ]);
    assert.strictEqual(layout.pages, 2);
    assert.strictEqual(at(layout, "AAA").page, 1);
    assert.strictEqual(at(layout, "BBB").page, 2);
    assert.strictEqual(at(layout, "BBB").row, 3);
  });

  test("同じ行へのスキップは改ページしない（前ではない）", () => {
    const layout = resolvePrtfLayout([
      record("R1", "SKIPB(10)"),
      constant(5, "AAA"),
      record("R2", "SKIPB(10)"),
      constant(5, "BBB")
    ]);
    assert.strictEqual(layout.pages, 1);
    assert.strictEqual(at(layout, "BBB").page, 1);
  });

  test("行送り（SPACE）だけでは改ページしない", () => {
    const layout = resolvePrtfLayout([
      record("R1", "SPACEA(1)"),
      constant(5, "AAA"),
      record("R2", "SPACEA(1)"),
      constant(5, "BBB")
    ]);
    assert.strictEqual(layout.pages, 1);
  });
});

suite("帳票のページ: 原典の例（LPI が変わる）", () => {
  /**
   * 原典（`LPI`）の計算例をそのまま:
   * > 6 LPI で 24 行 (4 インチ) 印刷し、次に 8 LPI で 24 行 (3 インチ) 印刷した
   * > 場合には、**48 行目はページの始めから 7 インチ**の位置にきます。
   */
  test("**6 LPI で 24 行 → 8 LPI で 24 行 → 48 行目は 7 インチ**", () => {
    const layout = resolvePrtfLayout([
      keywordLine("LPI(6)"),
      record("R1", "SPACEA(24)"),
      constant(5, "AAA"),
      record("R2", "LPI(8)"),
      keywordLine("SPACEA(24)"),
      constant(5, "BBB"),
      record("R3", "LPI(8)"),
      constant(5, "CCC")
    ]);
    // AAA は 1 行目（0 インチ）、そのあと 24 行進んで 4 インチ。
    assert.strictEqual(at(layout, "AAA").inches, 0);
    // BBB は 8 LPI に切り替わったあとの 1 行目 ＝ 4 インチ。
    assert.strictEqual(at(layout, "BBB").inches, 4);
    // BBB のあと 24 行を 8 LPI で進む → 4 + 3 = 7 インチ。
    assert.strictEqual(at(layout, "CCC").inches, 7);
    assert.strictEqual(at(layout, "CCC").row, 49);
  });

  /**
   * > この例で…`SKIPB(55)` という キーワードが使用されたとすれば…2 番目の例では、
   * > **8 LPI に基づいて、改ページが行われ**、55 行目…から印刷が開始されます。
   * > …**8 LPI に基づく 55 行目へのスキップは 7 インチ未満**となるため…
   */
  test("**7 インチにいるとき 8 LPI の SKIPB(55) は改ページ**（55/8 = 6.875）", () => {
    const layout = resolvePrtfLayout([
      keywordLine("LPI(6)"),
      record("R1", "SPACEA(24)"),
      constant(5, "AAA"),
      record("R2", "LPI(8)"),
      keywordLine("SPACEA(24)"),
      constant(5, "BBB"),
      record("R3", "LPI(8) SKIPB(55)"),
      constant(5, "CCC")
    ]);
    assert.strictEqual(at(layout, "CCC").page, 2, "改ページしていない");
    assert.strictEqual(at(layout, "CCC").inches, 55 / 8);
  });

  /** 同じ 55 行目でも **6 LPI なら 9.17 インチ**で、7 インチより後なので改ページしない。 */
  test("LPI が違えば同じ行番号でも答えが変わる", () => {
    const layout = resolvePrtfLayout([
      keywordLine("LPI(6)"),
      record("R1", "SPACEA(24)"),
      constant(5, "AAA"),
      record("R2", "LPI(8)"),
      keywordLine("SPACEA(24)"),
      constant(5, "BBB"),
      record("R3", "SKIPB(55)"),
      constant(5, "CCC")
    ]);
    // LPI(8) はレコードの終わりでファイル・レベル（6）へ戻る（原典）。
    assert.strictEqual(at(layout, "CCC").page, 1, "改ページしてしまった");
    assert.strictEqual(at(layout, "CCC").inches, 55 / 6);
  });

  /**
   * > 次に、SPACEA(4) (LPI は まだ 8 LPI のまま) を実行したとすれば、最後の行から
   * > **1/2 インチの行送り**が行われ、ページの始めから**合計 7.5 インチ**の位置になります。
   */
  test("**8 LPI の SPACEA(4) は 1/2 インチ進む**", () => {
    const layout = resolvePrtfLayout([
      keywordLine("LPI(6)"),
      record("R1", "SPACEA(24)"),
      constant(5, "AAA"),
      record("R2", "LPI(8)"),
      keywordLine("SPACEA(24)"),
      constant(5, "BBB"),
      record("R3", "LPI(8) SPACEA(4)"),
      constant(5, "CCC"),
      record("R4", "LPI(8)"),
      constant(5, "DDD")
    ]);
    assert.strictEqual(at(layout, "CCC").inches, 7);
    assert.strictEqual(at(layout, "DDD").inches, 7.5);
  });

  /** 原典: 「レコード様式の終わりに達すると、LPI の値はファイル・レベルの値に戻ります」 */
  test("**LPI はレコードの終わりでファイル・レベルへ戻る**", () => {
    const layout = resolvePrtfLayout([
      keywordLine("LPI(6)"),
      record("R1", "LPI(12) SPACEA(12)"),
      constant(5, "AAA"),
      record("R2", "SPACEA(6)"),
      constant(5, "BBB"),
      record("R3"),
      constant(5, "CCC")
    ]);
    // R1 は 12 LPI で 12 行 ＝ 1 インチ。
    assert.strictEqual(at(layout, "BBB").inches, 1);
    // R2 は LPI を書いていないので 6 LPI に戻る。6 行 ＝ 1 インチ。
    assert.strictEqual(at(layout, "CCC").inches, 2);
  });
});

suite("帳票のページ: 描画モデル", () => {
  const LINES = [
    record("R1", "SKIPB(40)"),
    constant(5, "AAA"),
    record("R2", "SKIPB(3)"),
    constant(5, "BBB")
  ];

  /**
   * **モデルは全ページ分を持つ。** 絞るのは描くとき（`selectPrintPage`）——
   * ページを替えるたびにホストへ作り直しを頼むと、往復のあいだ絵が消える。
   */
  test("モデルは全ページ分の項目を持ち、各項目がページ番号を持つ", () => {
    const model = buildPrtfRenderModel(LINES);
    assert.strictEqual(model.pages, 2);
    assert.deepStrictEqual(model.items.map(item => item.label), ["AAA", "BBB"]);
    assert.deepStrictEqual(model.items.map(item => item.page), [1, 2]);
  });

  test("**selectPrintPage がそのページだけに絞る**", () => {
    const model = buildPrtfRenderModel(LINES);
    assert.deepStrictEqual(
      selectPrintPage(model, 1).items.map(item => item.label),
      ["AAA"]
    );
    assert.deepStrictEqual(
      selectPrintPage(model, 2).items.map(item => item.label),
      ["BBB"]
    );
    assert.strictEqual(selectPrintPage(model, 2).currentPage, 2);
  });

  test("無いページを指定しても端に丸める（空の絵にしない）", () => {
    const model = buildPrtfRenderModel(LINES);
    assert.strictEqual(selectPrintPage(model, 99).currentPage, 2);
    assert.strictEqual(selectPrintPage(model, 0).currentPage, 1);
    assert.strictEqual(selectPrintPage(model, 99).items.length, 1);
  });

  test("画面ファイルのモデルはそのまま返す", () => {
    const { buildDspfRenderModel } = require("../../src/core/dds/dspfRenderModel");
    const model = buildDspfRenderModel([
      "     A          R MAIN",
      "     A            FLD1          10A  B  5  2"
    ]);
    assert.strictEqual(selectPrintPage(model, 2), model);
  });

  test("1 ページの帳票では pages が 1", () => {
    const model = buildPrtfRenderModel([record("R1", "SPACEA(1)"), constant(5, "AAA")]);
    assert.strictEqual(model.pages, 1);
  });
});
