import * as assert from "assert";
import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintDocument } from "../../src/language/lintDiagnostics";
import { RpgClDiagnostics } from "../../src/language/diagnostics";

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

/**
 * 消費経路の到達性。
 *
 * AGENTS.md「追加したリソースは『到達可能』になって初めて完了」。この PJ は
 * 定義を足したのに配線が無くて死蔵、を何度か踏んでいる。lintDocument が
 * 正しく動いても、diagnostics.refresh から呼ばれていなければ画面には何も出ない。
 * ここでは **RpgClDiagnostics.refresh を実際に通して** 収集に入ることを見る。
 */
suite("lint: 診断の配線（refresh からの到達性）", () => {
  teardown(() => setConfig({}));

  function collectionOf(diagnostics: RpgClDiagnostics) {
    return (diagnostics as unknown as {
      collection: { get(uri: { fsPath: string }): unknown[] | undefined };
    }).collection;
  }

  test("refresh 経由で RPG の診断が収集に入る", () => {
    const diagnostics = new RpgClDiagnostics();
    const document = fakeDocument("EMPMNT01.rpgle");
    diagnostics.refresh(document);

    const stored = collectionOf(diagnostics).get(document.uri);
    assert.ok(stored && stored.length > 0, "refresh から lint core に届いていない");
  });

  test("refresh 経由で DDS の診断が収集に入る（正常なら空）", () => {
    const diagnostics = new RpgClDiagnostics();
    const document = fakeDocument("CUSTMST.pf");
    diagnostics.refresh(document);

    assert.deepStrictEqual(collectionOf(diagnostics).get(document.uri), []);
  });

  test("refresh は CL の既存経路を壊さない（lint に流さない）", () => {
    const diagnostics = new RpgClDiagnostics();
    const document = fakeDocument("DYBAT001CL.clp");
    diagnostics.refresh(document);

    // CL は parseClDocument の担当。lint の桁検査は走らない。
    const stored = collectionOf(diagnostics).get(document.uri);
    assert.ok(Array.isArray(stored), "CL でも収集は設定される");
  });

  test("対象外の拡張子は収集に触れない", () => {
    const diagnostics = new RpgClDiagnostics();
    const document = fakeDocument("CUSTMST.pf");
    (document as unknown as { uri: { fsPath: string } }).uri = {
      fsPath: "/tmp/readme.txt"
    };
    diagnostics.refresh(document);

    assert.strictEqual(
      collectionOf(diagnostics).get(document.uri),
      undefined,
      "isInScopeDocument で弾かれるはず"
    );
  });
});
