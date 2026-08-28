import * as assert from "assert";
import { indexExceedingWidth, printWidth } from "../../src/core/dbcs";
import { foldKeywordArea } from "../../src/core/dds/ddsEditWriteBack";
import { validateDdsEdits, type DdsEdit } from "../../src/core/dds/ddsEdit";
import { readConstant, toLogicalUnits } from "../../src/core/dds/ddsLogicalUnits";

/**
 * **行の桁は「実機の桁」で数える**（JS の文字数ではない）。
 *
 * ローカルのソースに SO/SI は無いが、実機のメンバーでは DBCS の連なりの前後に
 * 1 桁ずつ入り、全角 1 文字は 2 桁を占める。
 *
 * 実機で境目を測った（IBM i 7.3 / `CRTDSPF`。
 * `.aidev/works/20260828-dds-line-width-columns/verify/probe-dbcs-width.mjs`）:
 *
 * | 定数の中身 | 実機の桁 | `CRTDSPF` |
 * |---|---|---|
 * | 全角 15 | 34 | 通る |
 * | 全角 16 | **36（ちょうど）** | 通る |
 * | 全角 17 | 38 | **通らない** |
 * | 半角 2 ＋ 全角 15 | **36（ちょうど）** | 通る |
 * | 半角 3 ＋ 全角 15 | 37 | **通らない** |
 *
 * `printWidth` の値と実機の可否が完全に一致する。
 */

const KEYWORD_AREA = 36;

suite("実機の桁: 数え方", () => {
  test("DBCS の連なりの前後に SO/SI が 1 桁ずつ入る", () => {
    assert.strictEqual(printWidth("ABC"), 3);
    assert.strictEqual(printWidth("顧客一覧表"), 12); // SO + 5*2 + SI
    assert.strictEqual(printWidth("A顧客B"), 8);
    assert.strictEqual(printWidth("あZい"), 9); // 途切れるたびに SO/SI
  });

  /** 実機で測った境目。`'` が 2 桁を使うので中身は全角 16 まで。 */
  test("**キーワード欄（36 桁）に入る全角は 16 文字まで**", () => {
    assert.strictEqual(printWidth(`'${"顧".repeat(16)}'`), KEYWORD_AREA);
    assert.ok(printWidth(`'${"顧".repeat(17)}'`) > KEYWORD_AREA);
  });

  test("半角と混ざっても実機と一致する", () => {
    assert.strictEqual(printWidth(`'${"X".repeat(2)}${"顧".repeat(15)}'`), KEYWORD_AREA);
    assert.ok(printWidth(`'${"X".repeat(3)}${"顧".repeat(15)}'`) > KEYWORD_AREA);
  });

  test("溢れ始める位置は JS の添字で返る（下線を引くため）", () => {
    assert.strictEqual(indexExceedingWidth("X".repeat(100), 100), undefined);
    assert.strictEqual(indexExceedingWidth("X".repeat(101), 100), 100);
    assert.strictEqual(indexExceedingWidth(`'${"顧".repeat(16)}'`, KEYWORD_AREA), undefined);
    assert.strictEqual(indexExceedingWidth(`'${"顧".repeat(17)}'`, KEYWORD_AREA), 17);
  });
});

suite("実機の桁: キーワード欄の折り返し", () => {
  /**
   * 直す前は JS の文字数で数えており、**実機がコンパイルを通さない欄を書き出していた**
   * （全角 17 文字の定数は JS 19 文字なので「36 桁に収まる」と判定されていた）。
   */
  test("**全角 17 文字の定数は折られる**（JS では 19 文字で収まって見える）", () => {
    const chunks = foldKeywordArea(`'${"顧".repeat(17)}'`);
    assert.ok(chunks.length > 1, `折られていない: ${JSON.stringify(chunks)}`);
    for (const chunk of chunks) {
      assert.ok(
        printWidth(chunk) <= KEYWORD_AREA,
        `${printWidth(chunk)} 桁の塊がある: ${chunk}`
      );
    }
  });

  test("全角 16 文字は折らない（36 桁ちょうど）", () => {
    assert.deepStrictEqual(foldKeywordArea(`'${"顧".repeat(16)}'`), [`'${"顧".repeat(16)}'`]);
  });

  test("どの塊も実機の桁で 36 を超えない（全角の量を変えて総当たり）", () => {
    for (let count = 1; count <= 40; count += 1) {
      const chunks = foldKeywordArea(`COLOR(RED) '${"顧".repeat(count)}' DSPATR(RI)`);
      for (const chunk of chunks) {
        assert.ok(
          printWidth(chunk) <= KEYWORD_AREA,
          `全角 ${count}: ${printWidth(chunk)} 桁の塊がある: ${chunk}`
        );
      }
    }
  });

  test("半角だけのときの折り方は変わらない（回帰）", () => {
    assert.deepStrictEqual(
      foldKeywordArea("COLOR(RED) DSPATR(RI HI ND) CHECK(RZ) DSPATR(UL)"),
      ["COLOR(RED) DSPATR(RI HI ND)", "CHECK(RZ) DSPATR(UL)"]
    );
  });
});

suite("実機の桁: 折った定数を読み直す", () => {
  /**
   * **折った結果を読み直して同じ値に戻ること。** 桁だけ合っていても、
   * 継続をまたいだリテラルが壊れていれば意味がない。
   * 折った形が実機で通ることは `verify/verify-folded-dbcs.mjs` が確かめている。
   */
  test("全角の定数は折っても読み直しで同じ値に戻る", () => {
    for (let count = 1; count <= 40; count += 1) {
      const literal = "顧".repeat(count);
      const chunks = foldKeywordArea(`'${literal}'`);
      const lines = [
        "     A          R MAIN",
        `     A                                  5  2${chunks[0]}`,
        ...chunks.slice(1).map(chunk => `     A                                      ${chunk}`)
      ];
      const unit = toLogicalUnits(lines).find(candidate => candidate.kind === "item");
      assert.ok(unit, `全角 ${count}: 項目として読めない`);
      assert.strictEqual(readConstant(unit.keywords), literal, `全角 ${count}`);
    }
  });

  test("半角と全角が混ざっても戻る", () => {
    for (const literal of ["A顧客B", "あZい", "顧客 一覧", "X".repeat(20) + "顧".repeat(20)]) {
      const chunks = foldKeywordArea(`'${literal}'`);
      const lines = [
        "     A          R MAIN",
        `     A                                  5  2${chunks[0]}`,
        ...chunks.slice(1).map(chunk => `     A                                      ${chunk}`)
      ];
      const unit = toLogicalUnits(lines).find(candidate => candidate.kind === "item");
      assert.ok(unit, `${literal}: 項目として読めない`);
      assert.strictEqual(readConstant(unit.keywords), literal, literal);
    }
  });
});

suite("実機の桁: 編集の上限", () => {
  const LINES = ["     A          R MAIN", "     A                                  5  2'X'"];

  /** 100 桁は**実機の桁**。全角なら 1 文字で 2 桁使う。 */
  test("**全角で 100 桁を超える書き換えは拒否する**", () => {
    const edits: DdsEdit[] = [
      { kind: "setAttributes", sourceLine: 2, attributes: { text: "顧".repeat(30) } }
    ];
    const codes = validateDdsEdits(LINES, edits, "DDS-DSPF").map(r => r.code);
    assert.ok(codes.includes("line-too-long"), JSON.stringify(codes));
  });

  test("実機の桁で収まる書き換えは通る", () => {
    const edits: DdsEdit[] = [
      { kind: "setAttributes", sourceLine: 2, attributes: { text: "顧".repeat(10) } }
    ];
    assert.deepStrictEqual(validateDdsEdits(LINES, edits, "DDS-DSPF"), []);
  });
});
