import * as assert from "assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toLogicalUnits } from "../../src/core/dds/ddsLogicalUnits";
import {
  activeKeywordGroups,
  resolveKeywordGroups
} from "../../src/core/dds/ddsConditioning";
import { resolveAppearanceUnder } from "../../src/core/dds/dspfAttributes";
import { applyIndicators, buildDspfRenderModel } from "../../src/core/dds/dspfRenderModel";
import { buildPrtfRenderModel } from "../../src/core/dds/prtfRenderModel";

/**
 * 条件つきの `COLOR` / `DSPATR`。
 *
 * 原典（`表示装置ファイルの条件付け (7 - 16 桁目)`）:
 * > ユーザー・プログラムでは、オプション標識をオン (16 進数 F1) またはオフ (16 進数 F0) に
 * > セットすることにより、**フィールドまたはキーワード**を選択することができます。
 *
 * 直す前は `toLogicalUnits` がキーワードだけの行の条件付け欄を捨てており、
 * **標識を倒しても反転表示が消えなかった**。
 */

const SAMPLE = [
  "     A                                      DSPSIZ(24 80 *DS3)",
  "     A          R MAIN",
  "     A                                  1  2'見出し'",
  "     A  01        FLD1          10A  B  5  2",
  "     A  02        FLD2          10A  B  5 20",
  "     A  30                                  DSPATR(RI)",
  "     A            FLD3          10A  O  7  2COLOR(BLU)",
  "     A  40                                  COLOR(RED)"
];

const ROOT = join(__dirname, "..", "..", "..", "..");

suite("条件つきキーワード: 桁の切り出し", () => {
  test("キーワードだけの行は自分の条件を持つ", () => {
    const units = toLogicalUnits(SAMPLE);
    const fld2 = units.find(unit => unit.line.includes("FLD2"));
    assert.ok(fld2, "FLD2 が無い");
    assert.strictEqual(fld2.keywordGroups.length, 2, "群が分かれていない");
    // 代表行は無条件（項目自身の条件は conditioningLines が持つ）。
    assert.deepStrictEqual(fld2.keywordGroups[0].conditioningLines, []);
    assert.strictEqual(fld2.keywordGroups[1].keywords, "DSPATR(RI)");
    assert.strictEqual(fld2.keywordGroups[1].sourceLine, 6);
  });

  /**
   * **`keywords` の意味を変えていない。** `readConstant` / `fieldWidth` /
   * `readSpacing` / チップ表示 / `setKeywords` の 5 か所が読んでいる。
   */
  test("群を連結すると keywords に一致する", () => {
    const sources = [
      SAMPLE,
      readFileSync(join(ROOT, "docs", "src", "CUSTMNT.dspf"), "utf8").split(/\r?\n/u),
      readFileSync(join(ROOT, "docs", "src", "CUSTRPT.prtf"), "utf8").split(/\r?\n/u),
      readFileSync(
        join(ROOT, "vscode-extension", "test", "golden", "RENDER1.dspf"), "utf8"
      ).split(/\r?\n/u)
    ];
    for (const lines of sources) {
      for (const unit of toLogicalUnits(lines)) {
        assert.strictEqual(
          unit.keywordGroups.map(group => group.keywords).join(" ").trim(),
          unit.keywords,
          `${unit.sourceLine} 行目で連結が一致しない`
        );
      }
    }
  });

  /**
   * 条件だけの行が**キーワードだけの行の前**に来る形。
   *
   * 原典より条件は直後の指定に付き「最後の (または唯一の) 標識は同じ行に指定」される。
   * 直す前は次の**項目**へ持ち越しており、その項目に無関係な条件が付いていた。
   */
  test("先行する条件行はキーワードの条件になる（次の項目に持ち越さない）", () => {
    const lines = [
      "     A          R MAIN",
      "     A            FLD1          10A  B  5  2",
      "     A  30",
      "     A O 31                                 DSPATR(RI)",
      "     A            FLD2          10A  B  6  2"
    ];
    const units = toLogicalUnits(lines);
    const fld1 = units.find(unit => unit.line.includes("FLD1"));
    const fld2 = units.find(unit => unit.line.includes("FLD2"));
    assert.ok(fld1 && fld2);

    const groups = resolveKeywordGroups(fld1);
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[1].conditioning.kind, "indicators", "条件が付いていない");

    // FLD2 には無関係な条件が付かない。
    assert.deepStrictEqual(fld2.conditioningLines, [lines[4]], "条件を持ち越している");
  });
});

suite("条件つきキーワード: 見え方", () => {
  const model = buildDspfRenderModel(SAMPLE);
  const find = (label: string, states: Record<string, "on" | "off"> = {}) => {
    const view = Object.keys(states).length === 0 ? model : applyIndicators(model, states);
    const item = view.items.find(candidate => candidate.label === label);
    assert.ok(item, `${label} が無い`);
    return item;
  };

  test("未設定は効かせる（既定の見え方が変わらない）", () => {
    assert.strictEqual(find("FLD2").appearance.reverse, true);
    assert.strictEqual(find("FLD3").appearance.color, "blue", "最初の COLOR が効く");
  });

  test("不成立と決まったら効かない", () => {
    assert.strictEqual(find("FLD2", { "30": "off" }).appearance.reverse, false);
  });

  test("成立していれば効く", () => {
    assert.strictEqual(find("FLD2", { "30": "on" }).appearance.reverse, true);
  });

  test("無関係な標識では変わらない", () => {
    assert.strictEqual(find("FLD2", { "50": "on" }).appearance.reverse, true);
  });

  /**
   * 原典（`COLOR`）: 「2 つ以上の COLOR キーワードが**有効になっている**場合には…
   * **DDS で最初に指定されている COLOR キーワード**を使用します」
   *
   * **有効になっているものの最初**なので、先に条件で絞ってから最初を採る。
   */
  test("条件で最初の COLOR が落ちると次のものが効く", () => {
    // 無条件の BLU が先。条件つきの RED は後ろなので、既定では BLU。
    assert.strictEqual(find("FLD3").appearance.color, "blue");

    // **項目そのものは無条件**にする。項目に条件を付けると、標識を倒したとき
    // 項目ごと消えてしまい、色の話が確かめられない。
    const conditionalFirst = buildDspfRenderModel([
      "     A          R MAIN",
      "     A            FLD3          10A  O  7  2",
      "     A  40                                  COLOR(RED)",
      "     A                                      COLOR(BLU)"
    ]);
    const on = conditionalFirst.items.find(candidate => candidate.label === "FLD3");
    assert.strictEqual(on?.appearance.color, "red", "先に書かれた COLOR が効いていない");
    const off = applyIndicators(conditionalFirst, { "40": "off" });
    const item = off.items.find(candidate => candidate.label === "FLD3");
    assert.ok(item);
    assert.strictEqual(item.appearance.color, "blue", "条件で落ちた COLOR が効いている");
  });

  test("状態が空なら同一参照を返す（既存の担保）", () => {
    assert.strictEqual(applyIndicators(model, {}), model);
  });

  test("条件つきの群を持たない項目は作り直さない", () => {
    const before = model.items.find(item => item.label === "見出し");
    const after = applyIndicators(model, { "30": "off" }).items.find(
      item => item.label === "見出し"
    );
    assert.strictEqual(after, before, "無関係な項目の参照が変わっている");
  });
});

suite("条件つきキーワード: 群の選び方", () => {
  const groups = resolveKeywordGroups(
    toLogicalUnits(SAMPLE).find(unit => unit.line.includes("FLD2"))!
  );

  test("shown / unknown は残し、hidden だけ落とす", () => {
    assert.strictEqual(activeKeywordGroups(groups, {}).length, 2, "未設定で落ちている");
    assert.strictEqual(activeKeywordGroups(groups, { "30": "on" }).length, 2);
    assert.strictEqual(activeKeywordGroups(groups, { "30": "off" }).length, 1);
  });

  test("resolveAppearanceUnder は絞ってから解く", () => {
    assert.strictEqual(resolveAppearanceUnder(groups, { "30": "on" }).reverse, true);
    assert.strictEqual(resolveAppearanceUnder(groups, { "30": "off" }).reverse, false);
  });
});

suite("条件つきキーワード: 帳票でも壊れない", () => {
  test("帳票にも群が載る（DSPATR は無いが経路は同じ）", () => {
    const lines = readFileSync(join(ROOT, "docs", "src", "CUSTRPT.prtf"), "utf8")
      .split(/\r?\n/u);
    const model = buildPrtfRenderModel(lines);
    assert.ok(model.items.length > 0, "項目が無い");
    for (const item of model.items) {
      assert.ok(Array.isArray(item.keywordGroups), "群が無い");
      assert.strictEqual(
        item.keywordGroups.map(group => group.keywords).join(" ").trim(),
        item.attributes.keywords,
        `${item.sourceLine} 行目で連結が一致しない`
      );
    }
  });
});
