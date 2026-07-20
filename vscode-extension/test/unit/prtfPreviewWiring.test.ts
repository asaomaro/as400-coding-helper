import * as assert from "assert";
import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerPrtfPreview } from "../../src/language/prtfPreview";

/**
 * 配線の到達性。
 *
 * AGENTS.md「追加したリソースは『到達可能』になって初めて完了」。この PJ は
 * 定義を足したのに配線が無くて死蔵、を何度か踏んでいる。HTML 生成が正しくても、
 * コマンドから WebView まで届いていなければ画面には何も出ない。
 * ここでは **コマンドを実際に実行して** HTML が入ることを見る。
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const SAMPLE = join(ROOT, "docs", "src", "CUSTRPT.prtf");

type Stub = {
  commands: { registered: Map<string, (...args: unknown[]) => unknown> };
  window: {
    activeTextEditor: unknown;
    messages: string[];
    __lastPanel?: { webview: { html: string }; __disposed?: boolean };
  };
};

const stub = vscode as unknown as Stub;

/** vscode.TextDocument の最小のふり。 */
function fakeDocument(fsPath: string, text: string): vscode.TextDocument {
  const lines = text.split(/\r?\n/);
  return {
    uri: { fsPath },
    lineCount: lines.length,
    lineAt: (index: number) => ({
      text: lines[index] ?? "",
      range: { start: { line: index, character: 0 }, end: { line: index, character: 0 } }
    })
  } as unknown as vscode.TextDocument;
}

function fakeContext(): vscode.ExtensionContext {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

function run(): void {
  const handler = stub.commands.registered.get("rpgClSupport.showPrtfPreview");
  assert.ok(handler, "コマンドが登録されていない");
  handler();
}

suite("PRTF プレビュー: 配線の到達性", () => {
  setup(() => {
    stub.commands.registered.clear();
    stub.window.messages.length = 0;
    stub.window.__lastPanel = undefined;
    stub.window.activeTextEditor = undefined;
    registerPrtfPreview(fakeContext());
  });

  test("コマンドが登録される", () => {
    assert.ok(stub.commands.registered.has("rpgClSupport.showPrtfPreview"));
  });

  test(".prtf でコマンドを実行すると WebView に HTML が入る", () => {
    const document = fakeDocument(SAMPLE, readFileSync(SAMPLE, "utf8"));
    stub.window.activeTextEditor = {
      document,
      selection: { active: { line: 0 } }
    };

    run();

    const html = stub.window.__lastPanel?.webview.html ?? "";
    assert.ok(html.length > 0, "コマンドから HTML 生成まで届いていない");
    assert.ok(html.includes("帳票プレビュー"), "プレビューの HTML ではない");
    // レイアウト解決を通っていること（定数が実機の桁で出る）。
    assert.ok(
      html.includes("width: calc(var(--cell) * 12)"),
      "レイアウト解決の結果が反映されていない"
    );
  });

  test(".prtf 以外では何もしない（メッセージだけ出す）", () => {
    stub.window.activeTextEditor = {
      document: fakeDocument("/tmp/x.rpgle", "     H"),
      selection: { active: { line: 0 } }
    };

    run();

    assert.strictEqual(stub.window.__lastPanel, undefined, "パネルが開いている");
    assert.strictEqual(stub.window.messages.length, 1);
    assert.ok(stub.window.messages[0]?.includes(".prtf"));
  });

  test("エディタが無いときは何もしない", () => {
    stub.window.activeTextEditor = undefined;
    run();
    assert.strictEqual(stub.window.__lastPanel, undefined);
  });

  test("紙面の大きさは設定を読む", () => {
    (vscode as unknown as { __setConfig(v: unknown): void }).__setConfig({
      rpgClSupport: { "prtf.pageWidth": 80 }
    });
    const document = fakeDocument(SAMPLE, readFileSync(SAMPLE, "utf8"));
    stub.window.activeTextEditor = {
      document,
      selection: { active: { line: 0 } }
    };

    run();

    const html = stub.window.__lastPanel?.webview.html ?? "";
    assert.ok(html.includes("var(--cell) * 80"), "設定の桁数が反映されていない");
    (vscode as unknown as { __setConfig(v: unknown): void }).__setConfig({});
  });
});
