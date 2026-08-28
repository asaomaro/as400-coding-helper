import * as assert from "assert";
import {
  isConditionable,
  unconditionableKeywords
} from "../../src/core/dds/ddsConditionable";
import { resolveDspfLayout } from "../../src/core/dds/dspfLayout";
import { resolvePrtfLayout } from "../../src/core/dds/prtfLayout";
import { toLogicalUnits } from "../../src/core/dds/ddsLogicalUnits";

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

suite("画面サイズ条件名: 2 次を指しているか（実機で確定）", () => {
  /**
   * **「DSPSIZ に宣言してあればよい」ではなかった。**
   * 実機で 8 通りを試して確定した（2026-08-28 / IBM i 7.3。
   * `.aidev/works/20260828-dds-undeclared-screen-size/verify/`）:
   *
   * | `DSPSIZ` | 条件名 | `CRTDSPF` |
   * |---|---|---|
   * | 無し | `*DS3` / `*DS4` | 通らない |
   * | `(24 80)` | `*DS4` | 通らない |
   * | `(24 80 27 132)` | `*DS3`（1 次） | **通らない** |
   * | `(24 80 27 132)` | `*DS4`（2 次） | 通る |
   * | `(27 132 *WIDE 24 80 *NORMAL)` | `*WIDE`（1 次） | **通らない** |
   * | 同上 | `*NORMAL`（2 次） | 通る |
   * | 同上 | `*NOTDEC` | 通らない |
   *
   * 8 通りすべてを「**2 次画面サイズを指していること**」という 1 つの規則が説明する。
   * 項目自身の行が 1 次の位置を与えるので、1 次を条件にした指定は矛盾する。
   */
  const withName = (name: string): string => {
    const chars = " ".repeat(80).split("");
    chars[5] = "A";
    for (let i = 0; i < name.length; i += 1) chars[8 + i] = name[i];
    for (let i = 0; i < 3; i += 1) {
      chars[38 + i] = "  3"[i];
      chars[41 + i] = "  4"[i];
    }
    return chars.join("").replace(/ +$/u, "");
  };
  const dspsiz = (text: string): string => {
    const chars = " ".repeat(80).split("");
    chars[5] = "A";
    for (let i = 0; i < text.length; i += 1) chars[44 + i] = text[i];
    return chars.join("").replace(/ +$/u, "");
  };

  const reports = (declaration: string | undefined, name: string): boolean =>
    resolveDspfLayout([
      ...(declaration === undefined ? [] : [dspsiz(declaration)]),
      "     A          R T",
      "     A            FLDB          10A  O  2  4",
      withName(name)
    ]).diagnostics.some(
      diagnostic => diagnostic.code === "invalid-screen-size-condition"
    );

  const CASES: ReadonlyArray<[string | undefined, string, boolean]> = [
    [undefined, "*DS4", true],
    [undefined, "*DS3", true],
    ["DSPSIZ(24 80)", "*DS4", true],
    ["DSPSIZ(24 80 27 132)", "*DS3", true],
    ["DSPSIZ(24 80 27 132)", "*DS4", false],
    ["DSPSIZ(27 132 *WIDE 24 80 *NORMAL)", "*WIDE", true],
    ["DSPSIZ(27 132 *WIDE 24 80 *NORMAL)", "*NORMAL", false],
    ["DSPSIZ(27 132 *WIDE 24 80 *NORMAL)", "*NOTDEC", true]
  ];

  for (const [declaration, name, expected] of CASES) {
    test(`${declaration ?? "DSPSIZ 無し"} + ${name} → ${expected ? "指摘する" : "指摘しない"}`, () => {
      assert.strictEqual(reports(declaration, name), expected);
    });
  }

  /**
   * **位置の上書き行**（「条件名 ＋ 位置」だけで名前もキーワードも無い行）でも指摘できる。
   *
   * 探し方は**生の行**を 1 行ずつ（`collectIndicators` と同じ）。
   * `20260828-dds-alternate-position` で上書き行は直前の項目へ付くようになったが、
   * **直前が項目でない場合**（様式の直後など）は付く先が無いので、
   * 単位から探すと取りこぼす。生の行なら形に依らず全部見える。
   */
  test("位置の上書き行（名前もキーワードも無い行）でも指摘できる", () => {
    assert.strictEqual(reports("DSPSIZ(24 80 27 132)", "*NOTDEC"), true);
  });

  test("直前が項目でない上書き行でも指摘できる（単位に付かない形）", () => {
    const lines = [
      dspsiz("DSPSIZ(24 80 27 132)"),
      "     A          R T",
      withName("*NOTDEC")
    ];
    // 様式の直後なので付く先が無い＝単位には入らない。
    assert.ok(
      !toLogicalUnits(lines).some(unit =>
        unit.alternatePositions.some(alternate => alternate.sourceLine === 3)
      ),
      "前提が変わった: 様式の直後の上書き行が項目に付いている"
    );
    assert.ok(
      resolveDspfLayout(lines).diagnostics.some(
        diagnostic => diagnostic.code === "invalid-screen-size-condition"
      ),
      "単位に付かない上書き行を取りこぼしている"
    );
  });
});
