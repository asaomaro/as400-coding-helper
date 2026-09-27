import * as assert from "assert";
import { resolveDspfLayout, type DspfPlacedItem } from "../../src/core/dds/dspfLayout";
import { buildDspfRenderModel } from "../../src/core/dds/dspfRenderModel";

/**
 * ウィンドウ様式（`WINDOW`）とサブファイルの 1 ページ（`SFLPAG`）。
 *
 * 期待値は原典 `docs/origin/dds/detail/rzakc_rzakcmstzwindow.htm` の例から写した:
 * - 例 1 `WINDOW(4 20 9 30)`: 「枠の右下隅は、上枠より 10 行下で、左枠から 33 桁右」、
 *   FIELD1（`2 10`）は「画面の 6 行目の 31 桁目」、FIELD2（`6 10`）は「画面の 10 行目の 31 桁目」。
 * - 例 3 `WINDOW(8 25 10 50)`: 「枠の右下隅は、19 行目の 78 桁目」、
 *   サブファイルの NAME（`4 5`）は「画面の 12 行目の 31 桁目」。
 */

function line(options: {
  nameType?: string;
  name?: string;
  length?: string;
  usage?: string;
  row?: string;
  column?: string;
  keywords?: string;
}): string {
  const cells = " ".repeat(100).split("");
  const put = (start: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) cells[start - 1 + i] = text[i]!;
  };
  put(6, "A");
  if (options.nameType) put(17, options.nameType);
  if (options.name) put(19, options.name);
  if (options.length) put(35 - options.length.length, options.length);
  if (options.usage) put(38, options.usage);
  if (options.row) put(42 - options.row.length, options.row);
  if (options.column) put(45 - options.column.length, options.column);
  if (options.keywords) put(45, options.keywords);
  return cells.join("").trimEnd();
}

const screenOf = (item: DspfPlacedItem) => ({
  row: item.row + (item.origin?.row ?? 0),
  column: item.column + (item.origin?.column ?? 0)
});

const example1 = [
  line({ nameType: "R", name: "WINDOW1", keywords: "WINDOW(4 20 9 30)" }),
  line({ name: "FIELD1", length: "20", usage: "I", row: "2", column: "10" }),
  line({ name: "FIELD2", length: "20", usage: "I", row: "6", column: "10" }),
  line({ nameType: "R", name: "RECORD1", keywords: "WINDOW(WINDOW1)" }),
  line({ name: "FIELD3", length: "5", usage: "O", row: "1", column: "2" }),
  line({ nameType: "R", name: "PLAIN" }),
  line({ name: "FIELD4", length: "5", usage: "O", row: "2", column: "2" })
];

const example3 = [
  line({ nameType: "R", name: "SFLDATA", keywords: "SFL" }),
  line({ name: "NAME", length: "20", usage: "B", row: "4", column: "5" }),
  line({ name: "RANK", length: "10", usage: "B", row: "4", column: "27" }),
  line({ nameType: "R", name: "WINDOW1", keywords: "SFLCTL(SFLDATA)" }),
  line({ keywords: "WINDOW(8 25 10 50)" }),
  line({ keywords: "SFLPAG(4)" }),
  line({ keywords: "SFLSIZ(17)" }),
  line({ keywords: "SFLDSP" }),
  line({ keywords: "SFLDSPCTL" })
];

suite("DSPF: ウィンドウ（WINDOW）", () => {
  test("枠の位置と大きさは原典の式（例 1: 下枠 14 行・右枠 53 桁）", () => {
    const { windows } = resolveDspfLayout(example1);
    assert.strictEqual(windows.length, 1);
    const [window] = windows;
    assert.deepStrictEqual(
      { top: window.top, left: window.left, bottom: window.bottom, right: window.right },
      { top: 4, left: 20, bottom: 14, right: 53 }
    );
    assert.strictEqual(window.messageLine, true, "既定は *MSGLIN");
    assert.deepStrictEqual(window.records, ["WINDOW1", "RECORD1"]);
  });

  test("中の項目は画面の位置に直して描く（例 1: FIELD1 は 6 行 31 桁、FIELD2 は 10 行 31 桁）", () => {
    const { items } = resolveDspfLayout(example1);
    const field = (name: string) => items.find(item => item.name === name)!;
    assert.deepStrictEqual(screenOf(field("FIELD1")), { row: 6, column: 31 });
    assert.deepStrictEqual(screenOf(field("FIELD2")), { row: 10, column: 31 });
    // 位置欄はソースの値のまま（書き戻しはこの値で行う）。
    assert.deepStrictEqual({ row: field("FIELD1").row, column: field("FIELD1").column }, { row: 2, column: 10 });
  });

  test("WINDOW(様式名) の様式は参照先のウィンドウに入り、ウィンドウの無い様式は画面のまま", () => {
    const { items } = resolveDspfLayout(example1);
    assert.deepStrictEqual(screenOf(items.find(item => item.name === "FIELD3")!), { row: 5, column: 23 });
    assert.strictEqual(items.find(item => item.name === "FIELD4")!.origin, undefined);
  });

  test("サブファイルは制御様式のウィンドウに入る（例 3: NAME は 12 行 31 桁、右下は 19 行 78 桁）", () => {
    const { items, windows } = resolveDspfLayout(example3);
    assert.deepStrictEqual({ bottom: windows[0].bottom, right: windows[0].right }, { bottom: 19, right: 78 });
    assert.deepStrictEqual(screenOf(items.find(item => item.name === "NAME")!), { row: 12, column: 31 });
  });

  test("ウィンドウの中の 1 行 1 桁は画面の 1 行 1 桁ではない（指摘しない）", () => {
    const { diagnostics } = resolveDspfLayout([
      line({ nameType: "R", name: "W", keywords: "WINDOW(4 20 9 30)" }),
      line({ name: "F", length: "5", usage: "O", row: "1", column: "1" })
    ]);
    assert.deepStrictEqual(diagnostics.map(d => d.code), []);
  });

  test("はみ出しはウィンドウで判定する（メッセージ行と桁数）", () => {
    const { diagnostics } = resolveDspfLayout([
      line({ nameType: "R", name: "W", keywords: "WINDOW(4 20 9 30)" }),
      // 9 行目はメッセージ行（原典: 最終ウィンドウ行はフィールドを含むことはできません）。
      line({ name: "MSGROW", length: "5", usage: "O", row: "9", column: "2" }),
      line({ name: "OK8", length: "5", usage: "O", row: "8", column: "2" }),
      // 26 + 5 - 1 = 30 桁目まで（収まる）/ 27 + 5 - 1 = 31 桁目（はみ出す）。
      line({ name: "FITS", length: "5", usage: "O", row: "1", column: "26" }),
      line({ name: "WIDE", length: "5", usage: "O", row: "2", column: "27" })
    ]);
    assert.deepStrictEqual(
      diagnostics.filter(d => d.code === "overflow").map(d => d.sourceLine),
      [2, 5]
    );
  });

  test("*NOMSGLIN なら最終行にも置ける", () => {
    const { diagnostics, windows } = resolveDspfLayout([
      line({ nameType: "R", name: "W", keywords: "WINDOW(4 20 9 30 *NOMSGLIN)" }),
      line({ name: "LAST", length: "5", usage: "O", row: "9", column: "2" })
    ]);
    assert.strictEqual(windows[0].messageLine, false);
    assert.deepStrictEqual(diagnostics.filter(d => d.code === "overflow"), []);
  });

  test("*DFT / &フィールド は開始位置が決まらない（大きさだけ持ち、仮に左上）", () => {
    for (const keywords of ["WINDOW(*DFT 9 30)", "WINDOW(&LIN &POS 9 30)"]) {
      const { windows } = resolveDspfLayout([
        line({ nameType: "R", name: "W", keywords }),
        line({ name: "F", length: "5", usage: "O", row: "1", column: "2" })
      ]);
      assert.strictEqual(windows.length, 1, keywords);
      assert.strictEqual(windows[0].startKnown, false, keywords);
      assert.deepStrictEqual({ lines: windows[0].lines, positions: windows[0].positions }, { lines: 9, positions: 30 });
    }
  });

  test("描画モデルに枠と中の項目の足し量が載る（2 次画面も）", () => {
    const model = buildDspfRenderModel(example1);
    assert.strictEqual(model.windows?.length, 1);
    assert.deepStrictEqual(model.items.find(item => item.label === "FIELD1")?.origin, { row: 4, column: 21 });
  });
});

/**
 * 実機の画面（IBM i 7.3。`docs/research/20260927-dds-editor-exploration/run/03-window.png` と
 * `01-subfile-page1.png`）と突き合わせたもの。ソースは同じ所の `ws/CMPLXD.dspf` から写した。
 *
 * - `WINDOW(8 20 9 44)` の `8  2'F12=戻る'` は画面の 16 行 23 桁に出る（PNG の位置）。
 *   テキストの写しでは 24 桁に見えるが、ウィンドウが下のサブファイルの 2 バイト文字を途中で
 *   切っているための数え違いで、PNG の位置が正しい。
 * - 枠の右端は 67 桁（20 + 44 + 3）、下端は 18 行（8 + 9 + 1）。カーソルは 9 行 22 桁（最初の使用可能位置）。
 * - `SFLPAG(0012)` の 1 行のサブファイルは 7〜18 行に 12 行並ぶ。
 */
suite("DSPF: ウィンドウとサブファイル（実機の画面と一致）", () => {
  const cmplxd = [
    "     A          R SFL01                     SFL",
    "     A            OPT            1A  B  7  3VALUES(' ' '1' '5') DSPATR(UL)",
    "     A            CUSNO          7Y 0O  7  7EDTCDE(Z)",
    "     A          R SFCTL01                   SFLCTL(SFL01)",
    "     A                                      SFLSIZ(0050) SFLPAG(0012)",
    "     A                                      OVERLAY",
    "     A          R WIN01                     WINDOW(8 20 9 44)",
    "     A                                  2  2'CODE'",
    "     A                                  8  2'F12=BACK' COLOR(BLU)"
  ];

  test("ウィンドウの中の定数は実機と同じ位置（8 2 → 16 行 23 桁）", () => {
    const { items, windows } = resolveDspfLayout(cmplxd);
    assert.deepStrictEqual(screenOf(items.find(item => item.text === "F12=BACK")!), { row: 16, column: 23 });
    assert.deepStrictEqual({ right: windows[0].right, bottom: windows[0].bottom }, { right: 67, bottom: 18 });
    // 最初の使用可能位置（実機のカーソル 9 行 22 桁）はウィンドウの 1 行 1 桁。
    const origin = items.find(item => item.text === "CODE")!.origin!;
    assert.deepStrictEqual({ row: 1 + origin.row, column: 1 + origin.column }, { row: 9, column: 22 });
  });

  test("SFLPAG(0012) の 1 行のサブファイルは 12 行並ぶ（7〜18 行）", () => {
    const { items } = resolveDspfLayout(cmplxd);
    assert.deepStrictEqual(items.find(item => item.name === "OPT")!.repeat, { count: 12, rowStep: 1 });
  });
});

suite("DSPF: サブファイルを SFLPAG ぶん描く", () => {
  test("1 件が 1 行なら SFLPAG 件・1 行ずつ", () => {
    const { items } = resolveDspfLayout(example3);
    assert.deepStrictEqual(items.find(item => item.name === "NAME")!.repeat, { count: 4, rowStep: 1 });
  });

  test("1 件が 2 行なら 2 行ずつ（実操作調査の SFL01 は 7〜8 行）", () => {
    const { items } = resolveDspfLayout([
      line({ nameType: "R", name: "SFL01", keywords: "SFL" }),
      line({ name: "A", length: "5", usage: "O", row: "7", column: "2" }),
      line({ name: "B", length: "5", usage: "O", row: "8", column: "2" }),
      line({ nameType: "R", name: "CTL01", keywords: "SFLCTL(SFL01)" }),
      line({ keywords: "SFLPAG(0006) SFLSIZ(0012) SFLDSP" })
    ]);
    assert.deepStrictEqual(items.find(item => item.name === "A")!.repeat, { count: 6, rowStep: 2 });
  });

  test("SFLLIN（横に並べる）と SFLPAG の無いものは並べない", () => {
    for (const keywords of ["SFLPAG(6) SFLLIN(2) SFLSIZ(12)", "SFLSIZ(12)"]) {
      const { items } = resolveDspfLayout([
        line({ nameType: "R", name: "S", keywords: "SFL" }),
        line({ name: "A", length: "5", usage: "O", row: "7", column: "2" }),
        line({ nameType: "R", name: "C", keywords: `SFLCTL(S) ${keywords}` })
      ]);
      assert.strictEqual(items.find(item => item.name === "A")!.repeat, undefined, keywords);
    }
  });
});
