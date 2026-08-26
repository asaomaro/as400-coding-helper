import * as assert from "assert";
import { resolveDspfLayout } from "../../src/core/dds/dspfLayout";

/**
 * 符号位置。**実機で確かめた 8 通りをそのまま回帰にする。**
 *
 * 35 桁目が `S`（ゾーン 10 進）かつ入力できる用途（`B` / `I`）のとき、画面上は 1 桁多く占める。
 * 原典に該当の記述を見つけられていないため、`SR-OSAKA` で `CRTDSPF` を実行して確定した事実
 * （`.aidev/works/20260826-dds-editor-port/research.md` F19）。
 *
 * **描く幅（`width`）には含まれない**——画面には空白として出るので、
 * 含めると存在しない文字を描くことになる。効くのは占有（重なり）とはみ出しの判定だけ。
 */

const COLUMN = 20;
const LENGTH = 5;

function layoutOf(dataType: string, usage: string, column = COLUMN): ReturnType<typeof resolveDspfLayout> {
  const cells = new Array<string>(80).fill(" ");
  const put = (start: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      cells[start - 1 + index] = text[index];
    }
  };
  put(6, "A");
  put(19, "NUMFLD");
  put(30, String(LENGTH).padStart(5));
  put(35, dataType);
  put(36, " 0");
  put(38, usage);
  put(39, "  5");
  put(42, String(column).padStart(3));

  return resolveDspfLayout([
    "     A                                      DSPSIZ(24 80 *DS3)",
    "     A          R TEST",
    cells.join("").trimEnd()
  ]);
}

/** 実機で確かめた表。増えるのは `S` × 入力可のときだけ。 */
const CASES: ReadonlyArray<{ dataType: string; usage: string; extra: number }> = [
  { dataType: "S", usage: "B", extra: 1 },
  { dataType: "S", usage: "I", extra: 1 },
  { dataType: "S", usage: "O", extra: 0 },
  { dataType: "Y", usage: "B", extra: 0 },
  { dataType: "Y", usage: "O", extra: 0 },
  { dataType: "Y", usage: "I", extra: 0 },
  { dataType: "A", usage: "B", extra: 0 },
  { dataType: "A", usage: "O", extra: 0 }
];

suite("符号位置: 実機で確かめた 8 通り", () => {
  for (const testCase of CASES) {
    test(`${testCase.dataType} × ${testCase.usage} → 占有 +${testCase.extra} 桁`, () => {
      const item = layoutOf(testCase.dataType, testCase.usage).items[0];
      assert.ok(item, "項目が解決できていない");
      // 占有は「属性文字を含む実効占有」なので、前後 1 桁ずつが基本形。
      assert.strictEqual(
        item.occupancy.end,
        COLUMN + LENGTH + testCase.extra,
        `占有の終端が違う（${JSON.stringify(item.occupancy)}）`
      );
    });
  }

  test("描く幅には含めない（画面には空白として出る）", () => {
    for (const testCase of CASES) {
      const item = layoutOf(testCase.dataType, testCase.usage).items[0];
      assert.strictEqual(item?.width, LENGTH, `${testCase.dataType}×${testCase.usage} の幅が変わった`);
    }
  });
});

suite("符号位置: はみ出しの判定にも効く", () => {
  test("76 桁目の 5 桁は、符号が付くと画面をはみ出す", () => {
    const overflow = layoutOf("S", "B", 76).diagnostics.filter(
      diagnostic => diagnostic.code === "overflow"
    );
    assert.strictEqual(overflow.length, 1, "はみ出しが検出されていない");
  });

  test("表示専用なら 76 桁目の 5 桁は収まる", () => {
    const overflow = layoutOf("S", "O", 76).diagnostics.filter(
      diagnostic => diagnostic.code === "overflow"
    );
    assert.deepStrictEqual(overflow, [], "はみ出しを誤検出している");
  });
});
