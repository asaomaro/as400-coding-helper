import * as assert from "assert";
import {
  isConditionable,
  unconditionableKeywords
} from "../../src/core/dds/ddsConditionable";
import { resolveDspfLayout } from "../../src/core/dds/dspfLayout";
import { resolvePrtfLayout } from "../../src/core/dds/prtfLayout";

/**
 * **キーワードにオプション標識を付けられるか。**
 *
 * DDS は条件が付く対象を「フィールド**または**キーワード」とするが、
 * キーワードごとに可否が決まっている。表は原典の各キーワード詳細ページから生成し
 * （`generate-dds-conditioning.mjs`）、**実機で確かめた 5 件**と突き合わせてある
 * （`verify-dds-conditioning.mjs`）。ここで見るのは引き方と、指摘の出方。
 */

const CONDITIONED_EDTCDE = [
  "     A          R MAIN",
  "     A            AMT            9S 2O 10 12",
  "     A  50                                  EDTCDE(J)"
];

suite("条件付けの可否: 表の引き方", () => {
  /** 実機（IBM i 7.3）で `CRTDSPF` に通した結果と同じであること。 */
  test("実機で確かめた 5 件と一致する", () => {
    assert.strictEqual(isConditionable("DSPF", "DSPATR"), true);
    assert.strictEqual(isConditionable("DSPF", "COLOR"), true);
    assert.strictEqual(isConditionable("DSPF", "EDTCDE"), false);
    assert.strictEqual(isConditionable("DSPF", "EDTWRD"), false);
    assert.strictEqual(isConditionable("DSPF", "CHECK"), false);
  });

  test("種別ごとに引く", () => {
    assert.strictEqual(isConditionable("PRTF", "EDTCDE"), false);
    assert.strictEqual(isConditionable("PRTF", "SPACEA"), true);
  });

  test("大文字小文字と前後の空白を吸収する", () => {
    assert.strictEqual(isConditionable("DSPF", " edtcde "), false);
  });

  /**
   * 原典が可否を書いていないキーワードがある。**知らないものは咎めない**
   * ——「付けられない」と決めつけると、実機で通るソースを弾くことになる。
   */
  test("原典に記述が無ければ undefined（咎めない）", () => {
    assert.strictEqual(isConditionable("DSPF", "ZZNOSUCHKW"), undefined);
    assert.deepStrictEqual(unconditionableKeywords("DSPF", "ZZNOSUCHKW(1)"), []);
  });

  test("キーワード欄から付けられないものだけを拾う", () => {
    assert.deepStrictEqual(
      unconditionableKeywords("DSPF", "DSPATR(RI) EDTCDE(J) CHECK(RB) COLOR(RED)"),
      ["EDTCDE", "CHECK"]
    );
    assert.deepStrictEqual(
      unconditionableKeywords("DSPF", "DSPATR(RI) COLOR(RED)"),
      []
    );
  });

  /** `CA03` は原典の総称 `CAnn` に正規化して引く（解説の引き方と同じ規則）。 */
  test("nn の総称に正規化して引く", () => {
    assert.strictEqual(isConditionable("DSPF", "CAnn"), true);
    assert.deepStrictEqual(unconditionableKeywords("DSPF", "CA03(03) CF12(12)"), []);
  });
});

suite("条件付けの可否: 指摘", () => {
  test("付けられないキーワードに条件が付いていたら指摘する", () => {
    const diagnostics = resolveDspfLayout(CONDITIONED_EDTCDE).diagnostics;
    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.strictEqual(diagnostics[0].code, "keyword-not-conditionable");
    assert.strictEqual(diagnostics[0].sourceLine, 3, "キーワードの行を指していない");
    assert.ok(diagnostics[0].message.includes("EDTCDE"));
  });

  test("付けられるキーワードは指摘しない", () => {
    const diagnostics = resolveDspfLayout([
      "     A          R MAIN",
      "     A            FLD1          10A  B  5  2",
      "     A  30                                  DSPATR(RI)"
    ]).diagnostics;
    assert.deepStrictEqual(diagnostics, []);
  });

  /**
   * **代表行は対象外。** そこに書かれたキーワードは項目自身の条件で決まるので、
   * 「キーワードに条件を付けた」ことにはならない。
   */
  test("代表行に条件が付いていても指摘しない", () => {
    const diagnostics = resolveDspfLayout([
      "     A          R MAIN",
      "     A  50        AMT            9S 2O 10 12EDTCDE(J)"
    ]).diagnostics;
    assert.deepStrictEqual(diagnostics, []);
  });

  test("条件が付いていなければ指摘しない", () => {
    const diagnostics = resolveDspfLayout([
      "     A          R MAIN",
      "     A            AMT            9S 2O 10 12",
      "     A                                      EDTCDE(J)"
    ]).diagnostics;
    assert.deepStrictEqual(diagnostics, []);
  });

  test("帳票でも同じように指摘する", () => {
    const diagnostics = resolvePrtfLayout([
      "     A          R HEAD",
      "     A            AMT            9S 2O  1 10",
      "     A  50                                  EDTCDE(J)"
    ]).diagnostics.filter(d => d.code === "keyword-not-conditionable");
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].sourceLine, 3);
  });
});
