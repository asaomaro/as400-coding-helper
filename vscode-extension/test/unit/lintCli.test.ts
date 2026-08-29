import * as assert from "assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toSarif } from "../../src/lint/sarif";
import { RULE_SPECS } from "../../src/lint/rules";
import { run } from "../../src/cli/lint";
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
    // `restricted-value` は既定 ON になった（値集合を実機で確かめた欄だけを見る）。
    assert.strictEqual(find("restricted-value").defaultConfiguration.level, "error");
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

  test("baseDir は区切りの境界まで見る（前方一致だけで削らない）", () => {
    // baseDir="/repo" が "/repository/..." に一致して先頭を削ってはいけない。
    const doc = toSarif(
      [{ fsPath: "/repository/docs/A.pf", findings: [FINDING] }],
      { baseDir: "/repo" }
    ) as any;
    assert.strictEqual(
      doc.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,
      "/repository/docs/A.pf"
    );
  });

  test("baseDir の外のファイルは絶対パスのまま返す", () => {
    // 先頭の "/" を落とすと、絶対パスなのに相対に見える uri になる。
    const doc = toSarif(
      [{ fsPath: "/elsewhere/A.pf", findings: [FINDING] }],
      { baseDir: "/repo" }
    ) as any;
    assert.strictEqual(
      doc.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,
      "/elsewhere/A.pf"
    );
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

/**
 * CLI の桁上限。
 *
 * **エディタと CI で同じ上限が使えることが要点**。片方だけ変えると、
 * レコード長 92（データ 80 桁）のソース物理ファイルで実機に入れた時点で
 * 切り捨てられる行が CI を素通りする。
 */
suite("lint CLI: --max-column", () => {
  /** 85 桁の行を 1 本だけ持つ検査用ソース。既定 100 では通り、上限 80 では捕まる。 */
  function fixture(): { source: string; output: string } {
    const dir = mkdtempSync(join(tmpdir(), "lint-max-column-"));
    const source = join(dir, "SAMPLE.rpgle");
    writeFileSync(source, `${"A".repeat(85)}\n`, "utf8");
    return { source, output: join(dir, "out.txt") };
  }

  /** line-length だけを有効にして走らせ、テキスト出力を返す。 */
  function lint(args: readonly string[]): { code: number; text: string } {
    const { source, output } = fixture();
    const code = run([
      "--rule",
      "line-length",
      "--format",
      "text",
      "--output",
      output,
      ...args,
      source
    ]);
    return { code, text: readFileSync(output, "utf8") };
  }

  test("既定（100 桁）では 85 桁の行を指摘しない", () => {
    const { code, text } = lint([]);
    assert.strictEqual(code, 0);
    assert.ok(!text.includes("line-length"), text);
  });

  test("--max-column 80 なら同じ行を指摘する", () => {
    const { code, text } = lint(["--max-column", "80"]);
    assert.strictEqual(code, 1, "error の指摘が出れば終了コードは 1");
    assert.ok(text.includes("line-length"), text);
    assert.ok(text.includes("固定長ソースは 80 桁までです"), text);
    // 規則単体と同じメッセージであること（エディタと CI の食い違いを防ぐ要）。
    assert.ok(text.includes("（1-80 桁が仕様書。注記域は入りません）"), text);
  });

  test("不正な値は UsageError で落とす（黙って既定に戻さない）", () => {
    // 設定と違い、明示的に渡した値が無視されるのは事故のもと。
    for (const value of ["abc", "0", "-5", "1.5", "32755"]) {
      const { source } = fixture();
      assert.strictEqual(
        run(["--max-column", value, source]),
        2,
        `--max-column ${value} は使用法エラーになるべき`
      );
    }
  });

  test("値を伴わない --max-column も落ちる", () => {
    assert.strictEqual(run(["--max-column"]), 2);
  });

  test("使い方に、設定と同じ値を渡すべきことが書いてある", () => {
    // 渡し忘れの食い違いが最も踏みやすい罠なので、USAGE に明記されていること。
    // USAGE は --help のときだけ出るので、そちらで確かめる。
    const logs: string[] = [];
    const original = console.error;
    console.error = (message?: unknown) => void logs.push(String(message));
    try {
      assert.strictEqual(run(["--help"]), 0);
    } finally {
      console.error = original;
    }
    const usage = logs.join("\n");
    assert.ok(usage.includes("--max-column"), usage);
    assert.ok(usage.includes("rpgClSupport.lint.maxColumn"), usage);
  });
});
