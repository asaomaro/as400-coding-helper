import * as assert from "assert";
import { toSarif } from "../../src/lint/sarif";
import { RULE_SPECS } from "../../src/lint/rules";
import type { LintFinding } from "../../src/lint/types";

/**
 * SARIF の形を固定する。外部バリデータは使わない（ランタイム依存を増やさない）ので、
 * 必須プロパティの存在と型をここで見る。
 */

const FINDING: LintFinding = {
  ruleId: "numeric-field",
  severity: "error",
  message: "長さは数値欄です",
  line: 5,
  startColumn: 30,
  endColumn: 35,
  specKeyword: "DDS-PF",
  parameterName: "C30"
};

function sarif(findings: readonly LintFinding[] = [FINDING]) {
  return toSarif([{ fsPath: "/repo/docs/src/CUSTMST.pf", findings }], {
    baseDir: "/repo"
  }) as any;
}

suite("lint: SARIF", () => {
  test("トップレベルの必須プロパティ", () => {
    const doc = sarif();
    assert.strictEqual(doc.version, "2.1.0");
    assert.strictEqual(typeof doc.$schema, "string");
    assert.strictEqual(Array.isArray(doc.runs), true);
    assert.strictEqual(doc.runs.length, 1);
  });

  test("tool.driver に全規則が出る（無効なものも含む）", () => {
    const driver = sarif().runs[0].tool.driver;
    assert.strictEqual(typeof driver.name, "string");
    assert.strictEqual(driver.rules.length, RULE_SPECS.length);
    for (const rule of driver.rules) {
      assert.strictEqual(typeof rule.id, "string");
      assert.strictEqual(typeof rule.shortDescription.text, "string");
      assert.strictEqual(typeof rule.defaultConfiguration.level, "string");
    }
  });

  test("既定で無効な規則は level が none", () => {
    const driver = sarif().runs[0].tool.driver;
    const find = (id: string) => driver.rules.find((r: any) => r.id === id);
    assert.strictEqual(find("required-field").defaultConfiguration.level, "none");
    assert.strictEqual(find("restricted-value").defaultConfiguration.level, "none");
    assert.strictEqual(find("line-length").defaultConfiguration.level, "error");
    assert.strictEqual(find("numeric-alignment").defaultConfiguration.level, "warning");
  });

  test("result の必須プロパティと位置", () => {
    const result = sarif().runs[0].results[0];
    assert.strictEqual(result.ruleId, "numeric-field");
    assert.strictEqual(result.level, "error");
    assert.strictEqual(result.message.text, "長さは数値欄です");

    const region = result.locations[0].physicalLocation.region;
    assert.strictEqual(region.startLine, 5);
    assert.strictEqual(region.startColumn, 30);
    assert.strictEqual(region.endColumn, 35);
  });

  test("uri は baseDir からの相対で POSIX 区切り", () => {
    const location = sarif().runs[0].results[0].locations[0].physicalLocation;
    assert.strictEqual(location.artifactLocation.uri, "docs/src/CUSTMST.pf");
  });

  test("Windows の区切りも POSIX に直す", () => {
    const doc = toSarif(
      [{ fsPath: "C:\\repo\\docs\\src\\A.pf", findings: [FINDING] }],
      { baseDir: "C:\\repo" }
    ) as any;
    assert.strictEqual(
      doc.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,
      "docs/src/A.pf"
    );
  });

  test("指摘ゼロでも妥当な SARIF を出す", () => {
    const doc = sarif([]);
    assert.deepStrictEqual(doc.runs[0].results, []);
    assert.strictEqual(doc.runs[0].tool.driver.rules.length, RULE_SPECS.length);
  });

  test("warning は SARIF の warning に写る", () => {
    const doc = sarif([{ ...FINDING, ruleId: "numeric-alignment", severity: "warning" }]);
    assert.strictEqual(doc.runs[0].results[0].level, "warning");
  });
});
