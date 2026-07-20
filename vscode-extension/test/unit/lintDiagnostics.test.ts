import * as assert from "assert";
import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintDocument } from "../../src/language/lintDiagnostics";

/**
 * VSCode 側の殻。検査そのものは lint core のテストが見ているので、ここでは
 * 「設定が効くこと」と「LintFinding が Diagnostic に写ること」だけを見る。
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const SRC_DIR = join(ROOT, "docs", "src");

/** vscode.TextDocument の最小のふり。lintDocument が使う分だけ持つ。 */
function fakeDocument(file: string, text?: string): vscode.TextDocument {
  const fsPath = join(SRC_DIR, file);
  const lines = (text ?? readFileSync(fsPath, "utf8")).split(/\r?\n/);
  return {
    uri: { fsPath },
    lineCount: lines.length,
    lineAt: (index: number) => ({ text: lines[index] ?? "" })
  } as unknown as vscode.TextDocument;
}

const setConfig = (values: Record<string, Record<string, unknown>>) =>
  (vscode as unknown as { __setConfig(v: unknown): void }).__setConfig(values);

suite("lint: VSCode 診断", () => {
  teardown(() => setConfig({}));

  test("実機コンパイル確認済みのソースには診断を出さない", () => {
    assert.deepStrictEqual(lintDocument(fakeDocument("CUSTMST.pf")), []);
    assert.deepStrictEqual(lintDocument(fakeDocument("IOSAMP.rpgle")), []);
  });

  test("桁がずれていれば Diagnostic に写る", () => {
    const diagnostics = lintDocument(fakeDocument("EMPMNT01.rpgle"));
    assert.ok(diagnostics.length > 0, "桁ずれを検出するはず");

    const first = diagnostics[0]!;
    assert.strictEqual(first.severity, vscode.DiagnosticSeverity.Error);
    assert.strictEqual((first as { source?: string }).source, "rpgClSupport");
    assert.strictEqual(typeof first.message, "string");
    // 桁は 0 始まりに写す。
    assert.ok(first.range.start.character >= 0);
    assert.ok(first.range.end.character > first.range.start.character);
  });

  test("lint.enable が false なら診断を出さない", () => {
    setConfig({ rpgClSupport: { "lint.enable": false } });
    assert.deepStrictEqual(lintDocument(fakeDocument("EMPMNT01.rpgle")), []);
  });

  test("規則ごとに無効化できる", () => {
    const before = lintDocument(fakeDocument("EMPMNT01.rpgle"));
    assert.ok(before.some(d => (d as { code?: string }).code === "numeric-field"));

    setConfig({ rpgClSupport: { "lint.rules": { "numeric-field": false } } });
    const after = lintDocument(fakeDocument("EMPMNT01.rpgle"));
    assert.ok(
      !after.some(d => (d as { code?: string }).code === "numeric-field"),
      "無効にした規則の診断は消える"
    );
  });

  test("既定で無効な規則は設定で有効にできる", () => {
    const before = lintDocument(fakeDocument("EMPMNT01.rpgle"));
    setConfig({ rpgClSupport: { "lint.rules": { "required-field": true } } });
    const after = lintDocument(fakeDocument("EMPMNT01.rpgle"));
    assert.ok(after.length > before.length, "有効にした分だけ増える");
  });

  test("CL / .cmd は桁検査の対象外", () => {
    assert.deepStrictEqual(lintDocument(fakeDocument("DYBAT001CL.clp")), []);
    assert.deepStrictEqual(lintDocument(fakeDocument("ADDCUST.cmd")), []);
  });

  test("100 桁超の行を診断する", () => {
    const document = fakeDocument(
      "CUSTMST.pf",
      `     A          R CUSTREC${" ".repeat(90)}X`
    );
    const diagnostics = lintDocument(document);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual((diagnostics[0] as { code?: string }).code, "line-length");
  });
});
