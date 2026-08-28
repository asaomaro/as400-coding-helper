import * as assert from "assert";
import {
  DEFAULT_PRINT_APPEARANCE,
  printColorLabel,
  printColorNames,
  resolvePrintAppearance
} from "../../src/core/dds/prtfAppearance";
import { buildPrtfRenderModel } from "../../src/core/dds/prtfRenderModel";

/**
 * **帳票の見え方**（太字・下線・カラー）。画面の 5250 配色とは別物。
 *
 * 実機で確かめた（IBM i 7.3 / `CRTPRTF`。
 * `.aidev/works/20260828-dds-prtf-emphasis/verify/probe-prtf-appearance.mjs`）:
 *
 * | 形 | 実機 |
 * |---|---|
 * | `HIGHLIGHT` を様式に / 項目に | 通る / 通る |
 * | `UNDERLINE` を様式に / 項目に | **通らない** / 通る |
 * | `COLOR` を様式に / 項目に | **通らない** / 通る |
 * | `COLOR(BLK)` / `COLOR(BRN)` | 通る（帳票にしかない名前） |
 * | **`COLOR(WHT)`** | **通らない**（画面にはある名前） |
 * | `COLOR(*RGB 0 0 0)` | 通る |
 * | **`DSPATR(HI)`** | **通らない**（画面のキーワード） |
 */

suite("帳票の見え方: カラー名", () => {
  test("原典の 8 色（画面とは集合が違う）", () => {
    assert.deepStrictEqual(printColorNames(), [
      "BLK",
      "BLU",
      "BRN",
      "GRN",
      "PNK",
      "RED",
      "TRQ",
      "YLW"
    ]);
  });

  /** 実機で確かめた食い違い。ここが崩れると画面の表が混ざっている。 */
  test("**帳票にしかない BLK / BRN があり、画面にしかない WHT が無い**", () => {
    const names = printColorNames();
    assert.ok(names.includes("BLK"));
    assert.ok(names.includes("BRN"));
    assert.ok(!names.includes("WHT"), "画面の名前が混ざっている");
  });

  test("和名は原典の表から引く", () => {
    assert.strictEqual(printColorLabel("BRN"), "茶");
    assert.strictEqual(printColorLabel("TRQ"), "空");
    assert.strictEqual(printColorLabel("WHT"), undefined);
  });

  test("既定は黒（原典: COLOR を指定しなかった場合には黒）", () => {
    assert.strictEqual(DEFAULT_PRINT_APPEARANCE.color, "BLK");
    assert.strictEqual(resolvePrintAppearance("").color, "BLK");
  });
});

suite("帳票の見え方: 解決", () => {
  test("HIGHLIGHT は太字", () => {
    assert.strictEqual(resolvePrintAppearance("HIGHLIGHT").bold, true);
    assert.strictEqual(resolvePrintAppearance("").bold, false);
  });

  test("UNDERLINE は下線", () => {
    assert.strictEqual(resolvePrintAppearance("UNDERLINE").underline, true);
  });

  test("COLOR は名前で決まる", () => {
    assert.strictEqual(resolvePrintAppearance("COLOR(RED)").color, "RED");
    assert.strictEqual(resolvePrintAppearance("COLOR(BRN)").color, "BRN");
  });

  /** 原典: 「他の値は…出力装置によって異なります」。**決め打ちしない。** */
  test("**装置依存の形は色を決めない**（指定があることだけ伝える）", () => {
    for (const form of ["*RGB 50 50 0", "*CMYK 0 0 0 100", "*CIELAB 50 0 0", "*HIGHLIGHT 1 100"]) {
      const appearance = resolvePrintAppearance(`COLOR(${form})`);
      assert.strictEqual(appearance.deviceColor, true, form);
      assert.strictEqual(appearance.color, "BLK", form);
    }
  });

  test("画面にしかない名前は採らない（既定のまま）", () => {
    assert.strictEqual(resolvePrintAppearance("COLOR(WHT)").color, "BLK");
  });

  /**
   * 原典: 「HIGHLIGHT をレコード・レベルで指定した場合には…**すべてのフィールドに
   * 適用**されます」「どちらか一方の標識条件が満たされていれば」。
   */
  test("**様式の HIGHLIGHT は項目にも効く**", () => {
    assert.strictEqual(resolvePrintAppearance("", "HIGHLIGHT").bold, true);
    assert.strictEqual(resolvePrintAppearance("HIGHLIGHT", "").bold, true);
    assert.strictEqual(resolvePrintAppearance("HIGHLIGHT", "HIGHLIGHT").bold, true);
  });

  /** `UNDERLINE` / `COLOR` は項目レベルだけ（実機も様式に書くと通さない）。 */
  test("様式の UNDERLINE / COLOR は項目に効かせない", () => {
    assert.strictEqual(resolvePrintAppearance("", "UNDERLINE").underline, false);
    assert.strictEqual(resolvePrintAppearance("", "COLOR(RED)").color, "BLK");
  });

  test("画面のキーワードは読まない（DSPATR は帳票に無い）", () => {
    const appearance = resolvePrintAppearance("DSPATR(HI UL)");
    assert.strictEqual(appearance.bold, false);
    assert.strictEqual(appearance.underline, false);
  });
});

suite("帳票の見え方: 描画モデル", () => {
  /**
   * **桁は手で数えない。** 桁を置く助けで組み立てる——手で書くと必ずずれる
   * （最初にずれた fixture を書いて、項目が様式のキーワードに吸われた）。
   */
  const put = (line: string, column: number, value: string): string => {
    const chars = line.padEnd(80, " ").split("");
    for (let i = 0; i < value.length; i += 1) chars[column - 1 + i] = value[i];
    return chars.join("").replace(/ +$/u, "");
  };
  const blank = (): string => put(" ".repeat(80), 6, "A");
  const record = (name: string, keywords: string): string =>
    put(put(put(blank(), 17, "R"), 19, name), 45, keywords);
  const keywordLine = (keywords: string): string => put(blank(), 45, keywords);
  const constant = (col: number, text: string, keywords = ""): string =>
    put(put(blank(), 42, String(col).padStart(3)), 45, `'${text}'${keywords ? ` ${keywords}` : ""}`);
  const field = (name: string, length: number, type: string, col: number, keywords = ""): string =>
    put(
      put(put(put(put(blank(), 19, name), 30, String(length).padStart(5)), 35, type), 42, String(col).padStart(3)),
      45,
      keywords
    );

  const LINES = [
    record("HEADING", "SKIPB(1)"),
    keywordLine("HIGHLIGHT"),
    constant(5, "TITLE"),
    record("DETLINE", "SPACEA(1)"),
    field("ITEMNM", 20, "A", 20, "UNDERLINE"),
    field("AMOUNT", 9, "S", 50, "COLOR(RED)")
  ];

  test("**帳票の項目は printAppearance を持ち、画面の appearance は既定のまま**", () => {
    const model = buildPrtfRenderModel(LINES);
    for (const item of model.items) {
      assert.ok(item.printAppearance !== undefined, `${item.label} に printAppearance が無い`);
    }
    // 画面の色（緑）が付いていないこと。帳票は既定が黒。
    assert.ok(model.items.every(item => item.appearance.color === "green"));
  });

  test("様式の HIGHLIGHT がその中の項目に効く", () => {
    const model = buildPrtfRenderModel(LINES);
    const title = model.items.find(item => item.label.includes("TITLE"));
    assert.ok(title);
    assert.strictEqual(title.printAppearance?.bold, true);
  });

  test("別の様式には効かない", () => {
    const model = buildPrtfRenderModel(LINES);
    const amount = model.items.find(item => item.label === "AMOUNT");
    assert.ok(amount);
    assert.strictEqual(amount.printAppearance?.bold, false);
    assert.strictEqual(amount.printAppearance?.color, "RED");
  });

  test("下線が項目に付く", () => {
    const model = buildPrtfRenderModel(LINES);
    const name = model.items.find(item => item.label === "ITEMNM");
    assert.ok(name);
    assert.strictEqual(name.printAppearance?.underline, true);
  });

  test("画面ファイルには printAppearance が入らない", () => {
    const { buildDspfRenderModel } = require("../../src/core/dds/dspfRenderModel");
    const model = buildDspfRenderModel([
      "     A          R MAIN",
      "     A            FLD1          10A  B  5  2COLOR(RED)"
    ]);
    assert.ok(model.items.every((item: { printAppearance?: unknown }) => item.printAppearance === undefined));
  });
});
