import * as assert from "assert";
import { classifyLine } from "../../src/lint/preprocess";
import { lineLengthRule } from "../../src/lint/rules/lineLength";
import {
  numericAlignmentRule,
  numericFieldRule
} from "../../src/lint/rules/numericField";
import { RULE_SPECS, defaultEnabledRules } from "../../src/lint/rules";
import type { PrompterDefinition } from "../../src/prompter/types";

/** 長さ欄（30-34 桁・右寄せ必須）だけを持つ最小の定義。 */
const DDS_LENGTH_DEF = {
  keyword: "DDS-PF",
  description: "test",
  parameters: [
    {
      name: "C30",
      description: "長さ（30-34 桁目）",
      inputType: "text",
      required: false,
      sourceStart: 30,
      sourceLength: 5,
      attributes: { numericOnly: true }
    }
  ]
} as unknown as PrompterDefinition;

function context(line: string, definition?: PrompterDefinition) {
  return { line, lineNumber: 1, definition, specKeyword: "DDS-PF" };
}

suite("lint: 行の分類", () => {
  test("DDS は 7 桁目の * が注記", () => {
    assert.strictEqual(
      classifyLine("     A* コメント", "dds", "DDS-PF"),
      "comment"
    );
  });

  test("DDS は 7-80 桁が全て空白なら注記（原典のブランク行）", () => {
    // 1-6 桁に文字があっても、7-80 桁が空なら注記として扱われる。
    assert.strictEqual(classifyLine("     A", "dds", "DDS-PF"), "comment");
    assert.strictEqual(classifyLine("", "dds", "DDS-PF"), "comment");
  });

  test("DDS のキーワードのみの行は継続行", () => {
    assert.strictEqual(
      classifyLine(
        "     A                                      DSPSIZ(24 80 *DS3)",
        "dds",
        "DDS-DSPF"
      ),
      "continuation"
    );
  });

  test("DDS の名前がある行は検査対象", () => {
    assert.strictEqual(
      classifyLine("     A            CUSTNO         5S 0", "dds", "DDS-PF"),
      "checked"
    );
  });

  test("RPG は 7 桁目の * と空行が注記", () => {
    assert.strictEqual(classifyLine("     H* コメント", "rpg-fixed", "H-SPEC"), "comment");
    assert.strictEqual(classifyLine("   ", "rpg-fixed", undefined), "comment");
  });

  test("RPG の F/D 仕様は 7-16 桁が空なら継続行（原典の継続記入行）", () => {
    assert.strictEqual(
      classifyLine(
        "     F                                     RENAME(EMPMSTR:EMPREC)",
        "rpg-fixed",
        "F-SPEC"
      ),
      "continuation"
    );
    assert.strictEqual(
      classifyLine("     D                                     LIKE(X)", "rpg-fixed", "D-SPEC"),
      "continuation"
    );
  });

  test("C 仕様は 7-16 桁が空でも継続行ではない", () => {
    assert.strictEqual(
      classifyLine("     C                   EVAL      X = 1", "rpg-fixed", "C-NEW"),
      "checked"
    );
  });

  test("仕様書コードが読めない行は検査しない", () => {
    assert.strictEqual(classifyLine("     Z  なにか", "rpg-fixed", undefined), "skipped");
  });
});

suite("lint: line-length", () => {
  test("100 桁ちょうどは指摘しない", () => {
    assert.deepStrictEqual(lineLengthRule(context("A".repeat(100))), []);
  });

  test("80 桁超過は指摘しない（81-100 桁は原典が注記域と規定）", () => {
    assert.deepStrictEqual(lineLengthRule(context("A".repeat(95))), []);
  });

  test("101 桁で指摘し、範囲は 101 桁目から", () => {
    const findings = lineLengthRule(context("A".repeat(101)));
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0]?.ruleId, "line-length");
    assert.strictEqual(findings[0]?.startColumn, 101);
    assert.strictEqual(findings[0]?.endColumn, 102);
  });
});

suite("lint: numeric-field / numeric-alignment", () => {
  //            1234567890123456789012345678901234
  const ok = "     A            CUSTNO           30";
  const nonNumeric = "     A            CUSTNO        AB   ";
  const leftAligned = "     A            CUSTNO       30    ";

  test("右寄せの数字は指摘しない", () => {
    assert.deepStrictEqual(numericFieldRule(context(ok, DDS_LENGTH_DEF)), []);
    assert.deepStrictEqual(numericAlignmentRule(context(ok, DDS_LENGTH_DEF)), []);
  });

  test("空欄は指摘しない（未入力は別の規則の担当）", () => {
    const blank = "     A            CUSTNO              ";
    assert.deepStrictEqual(numericFieldRule(context(blank, DDS_LENGTH_DEF)), []);
    assert.deepStrictEqual(numericAlignmentRule(context(blank, DDS_LENGTH_DEF)), []);
  });

  test("数値欄に非数字なら numeric-field が指摘する", () => {
    const findings = numericFieldRule(context(nonNumeric, DDS_LENGTH_DEF));
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0]?.ruleId, "numeric-field");
    assert.strictEqual(findings[0]?.severity, "error");
    assert.strictEqual(findings[0]?.startColumn, 30);
  });

  test("非数字のときは numeric-alignment は重ねて指摘しない", () => {
    assert.deepStrictEqual(numericAlignmentRule(context(nonNumeric, DDS_LENGTH_DEF)), []);
  });

  test("左詰めなら numeric-alignment が warning で指摘する", () => {
    const findings = numericAlignmentRule(context(leftAligned, DDS_LENGTH_DEF));
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0]?.ruleId, "numeric-alignment");
    assert.strictEqual(findings[0]?.severity, "warning");
  });

  test("定義が無ければ何も見ない", () => {
    assert.deepStrictEqual(numericFieldRule(context(nonNumeric)), []);
  });
});

suite("lint: 規則の既定", () => {
  test("既定で有効なのは 3 規則", () => {
    assert.deepStrictEqual(defaultEnabledRules(), [
      "line-length",
      "numeric-field",
      "numeric-alignment"
    ]);
  });

  test("偽陽性が出ると分かっている 2 規則は既定で無効", () => {
    for (const id of ["required-field", "restricted-value"] as const) {
      const spec = RULE_SPECS.find(s => s.id === id);
      assert.strictEqual(spec?.enabledByDefault, false, `${id} は既定で無効`);
    }
  });

  test("継続記入行に適用してよいのは行長だけ", () => {
    const forContinuation = RULE_SPECS.filter(s => s.appliesToContinuation);
    assert.deepStrictEqual(
      forContinuation.map(s => s.id),
      ["line-length"]
    );
  });
});
