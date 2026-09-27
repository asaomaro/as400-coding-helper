import * as assert from "assert";
import { resolveDspfLayout } from "../../src/core/dds/dspfLayout";
import { resolvePrtfLayout } from "../../src/core/dds/prtfLayout";

/**
 * ソースの形だけで分かる、実機が作成しない誤り（実操作調査の D18）。
 * どれも実機（IBM i 7.3）で作成できないこと・対照が作成できることを確かめてある
 * （`.aidev/works/20260927-dds-validation-machine-errors/verify/`）。
 */

const codes = (diagnostics: readonly { code: string; sourceLine: number }[], code: string): number[] =>
  diagnostics.filter(d => d.code === code).map(d => d.sourceLine);

const SUBFILE = (clear: string): string[] => [
  "     A                                      DSPSIZ(24 80 *DS3) CA03(03)",
  "     A          R SFL01                     SFL",
  "     A            F1            10A  O  5  2",
  "     A          R CTL01                     SFLCTL(SFL01)",
  "     A                                      SFLSIZ(0010)",
  "     A                                      SFLPAG(0005)",
  "     A  31                                  SFLDSP",
  `     A${clear}                                  SFLCLR`,
  "     A                                  1  2'X'"
];

suite("DDS 検証: 実機が作成しない形（D18）", () => {
  test("SFLCLR に条件が無いと指摘する（CPD7490）。条件があれば指摘しない", () => {
    assert.deepStrictEqual(codes(resolveDspfLayout(SUBFILE("    ")).diagnostics, "keyword-needs-indicator"), [8]);
    assert.deepStrictEqual(codes(resolveDspfLayout(SUBFILE("  33")).diagnostics, "keyword-needs-indicator"), []);
  });

  test("使用 H・P・M の項目に位置があると指摘する（CPD7443 / CPD7436）。位置が無ければ指摘しない", () => {
    const source = (usage: string, position: string): string[] => [
      "     A                                      DSPSIZ(24 80 *DS3)",
      "     A          R REC",
      `     A            FLD           10A  ${usage}${position}`
    ];
    for (const usage of ["H", "P", "M"]) {
      assert.deepStrictEqual(codes(resolveDspfLayout(source(usage, "  3  2")).diagnostics, "position-not-allowed"), [3], usage);
      assert.deepStrictEqual(codes(resolveDspfLayout(source(usage, "")).diagnostics, "position-not-allowed"), [], usage);
    }
    assert.deepStrictEqual(codes(resolveDspfLayout(source("B", "  3  2")).diagnostics, "position-not-allowed"), []);
  });

  test("帳票の使用が B なら指摘する（CPD7410）。O・空白は指摘しない", () => {
    const source = (usage: string): string[] => [
      "     A          R PREC                      SPACEB(1)",
      `     A            FLD            5A  ${usage}     2`
    ];
    assert.deepStrictEqual(codes(resolvePrtfLayout(source("B")).diagnostics, "invalid-usage"), [2]);
    assert.deepStrictEqual(codes(resolvePrtfLayout(source("O")).diagnostics, "invalid-usage"), []);
    assert.deepStrictEqual(codes(resolvePrtfLayout(source(" ")).diagnostics, "invalid-usage"), []);
  });

  test("80 桁目までに閉じず次の行にも続かないリテラルを指摘する（CPD7508）", () => {
    const long = "     A                                  3  2'" + "-".repeat(60) + "'";
    const source = ["     A          R REC", long, "     A          R NEXT", "     A                                  1  2'X'"];
    assert.deepStrictEqual(codes(resolveDspfLayout(source).diagnostics, "unclosed-literal"), [2]);
  });

  test("継続（- / 継続記号なし）で次の行に続くリテラルは指摘しない", () => {
    const source = [
      "     A          R REC",
      "     A                                  5 12'ABC-",
      "     A                                      DEF'",
      // 継続記号なしでも、次の行がキーワードだけなら空白 1 つを挟んで続く（実機で確認済み）。
      "     A                                  7 12'ABC",
      "     A                                         DEF'",
      "     A                                  9  2'Z'"
    ];
    assert.deepStrictEqual(codes(resolveDspfLayout(source).diagnostics, "unclosed-literal"), []);
  });

  test("81-100 桁（注記域）に書いた文字は咎めない", () => {
    const source = [
      "     A          R REC",
      "     A                                  3  2'ABC'".padEnd(80) + "NOTE 'X"
    ];
    assert.deepStrictEqual(codes(resolveDspfLayout(source).diagnostics, "unclosed-literal"), []);
  });
});
