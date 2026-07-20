import * as assert from "assert";
import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDspfLayout } from "../../src/core/dds/dspfLayout";
import { buildDspfPreviewHtml } from "../../src/language/dspfPreviewHtml";
import { registerDspfPreview } from "../../src/language/dspfPreview";

/**
 * 画面プレビューの HTML 生成と、配線の到達性。
 *
 * AGENTS.md「追加したリソースは『到達可能』になって初めて完了」。
 * HTML が正しくても、コマンドから WebView まで届かなければ画面には何も出ない。
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const SAMPLE = join(ROOT, "docs", "src", "CUSTMNT.dspf");

function sampleHtml(activeSourceLine?: number): string {
  const layout = resolveDspfLayout(readFileSync(SAMPLE, "utf8").split(/\r?\n/u));
  return buildDspfPreviewHtml(layout, {
    cspSource: "vscode-resource:",
    nonce: "TESTNONCE",
    title: "CUSTMNT.dspf",
    ...(activeSourceLine !== undefined ? { activeSourceLine } : {})
  });
}

suite("DSPF プレビュー: HTML 生成", () => {
  const html = sampleHtml();

  test("画面の箱が DSPSIZ の 24×80 で作られる", () => {
    assert.ok(html.includes("width: calc(var(--cell) * 80)"));
    assert.ok(html.includes("height: calc(var(--line-height) * 24)"));
  });

  test("桁は --cell の整数倍で置く（フォントに依存しない）", () => {
    // 定数 '顧客保守' は 25 桁目・幅 10。
    assert.ok(html.includes("left: calc(var(--cell) * 24)"));
    assert.ok(html.includes("width: calc(var(--cell) * 10)"));
  });

  test("箱が権威なので画面からはみ出させない", () => {
    assert.ok(/\.screen\s*\{[^}]*overflow:\s*hidden/su.test(html));
  });

  test("項目にソース行・行・桁を持たせる（相互のたどりの鍵）", () => {
    assert.ok(/data-source-line="8"/u.test(html));
    assert.ok(/data-row="1"/u.test(html));
    assert.ok(/data-column="25"/u.test(html));
  });

  test("属性文字を描く（ソースに無いが桁を消費するもの）", () => {
    assert.ok(html.includes('class="attribute"'), "属性文字のマーカーが無い");
    // '顧客保守' の開始属性文字は 24 桁目 → left は 23 セル。
    assert.ok(html.includes("left: calc(var(--cell) * 23)"));
    // 終了属性文字は 35 桁目 → 34 セル。
    assert.ok(html.includes("left: calc(var(--cell) * 34)"));
  });

  test("幅不明の項目は破線の枠で位置だけ示す", () => {
    assert.ok(html.includes("unknown-width"));
    assert.ok(/\.item\.unknown-width\s*\{[^}]*dashed/su.test(html));
  });

  test("カーソル行の項目を強調する", () => {
    assert.ok(sampleHtml(8).includes("item constant active movable"));
  });

  test("解決できなかったものを注記に出す", () => {
    assert.ok(html.includes("幅が分からない項目が 2 件"));
    assert.ok(html.includes("プログラム桁数"), "表示桁数の限界が書かれていない");
  });

  test("実機で通るサンプルなので指摘は出ない", () => {
    assert.ok(html.includes("指摘はありません"));
  });

  test("CSP と nonce が入る", () => {
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(html.includes("script-src 'nonce-TESTNONCE'"));
    assert.ok(html.includes('<script nonce="TESTNONCE">'));
  });

  test("HTML をエスケープする", () => {
    const layout = resolveDspfLayout([
      "     A          R REC",
      "     A                                  1  2'<b>&\"'"
    ]);
    const escaped = buildDspfPreviewHtml(layout, {
      cspSource: "x",
      nonce: "n",
      title: "t"
    });
    assert.ok(escaped.includes("&lt;b&gt;&amp;&quot;"));
    assert.ok(!escaped.includes("<b>"));
  });

  test("ドラッグの受け口と送り口が対になっている", () => {
    assert.ok(html.includes("addEventListener('drop'"), "受け口が無い");
    assert.ok(html.includes("postMessage({ type: 'move'"), "送り口が無い");
    assert.ok(html.includes("type: 'reveal'"), "クリックの送り口が無い");
  });
});

type Stub = {
  commands: { registered: Map<string, (...args: unknown[]) => unknown> };
  window: {
    activeTextEditor: unknown;
    messages: string[];
    __lastPanel?: { webview: { html: string }; __disposed?: boolean };
  };
};

const stub = vscode as unknown as Stub;

function fakeDocument(fsPath: string, text: string): vscode.TextDocument {
  const lines = text.split(/\r?\n/u);
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
  const handler = stub.commands.registered.get("rpgClSupport.showDspfPreview");
  assert.ok(handler, "コマンドが登録されていない");
  handler();
}

function activate(fsPath: string, text: string): void {
  stub.window.activeTextEditor = {
    document: fakeDocument(fsPath, text),
    selection: { active: { line: 0 } }
  };
}

suite("DSPF プレビュー: 配線の到達性", () => {
  const sample = readFileSync(SAMPLE, "utf8");

  setup(() => {
    stub.commands.registered.clear();
    stub.window.messages.length = 0;
    stub.window.__lastPanel = undefined;
    stub.window.activeTextEditor = undefined;
    registerDspfPreview(fakeContext());
  });

  test("コマンドが登録される", () => {
    assert.ok(stub.commands.registered.has("rpgClSupport.showDspfPreview"));
  });

  test(".dspf でコマンドを実行すると WebView に HTML が入る", () => {
    activate(SAMPLE, sample);
    run();

    const html = stub.window.__lastPanel?.webview.html ?? "";
    assert.ok(html.length > 0, "コマンドから HTML 生成まで届いていない");
    assert.ok(html.includes("画面プレビュー"), "プレビューの HTML ではない");
    // レイアウト解決を通っていること（DBCS の定数が実機の桁で出る）。
    assert.ok(
      html.includes("width: calc(var(--cell) * 10)"),
      "レイアウト解決の結果が反映されていない"
    );
  });

  test(".mnudds でも開ける（resolveDdsType が DDS-DSPF に寄せている）", () => {
    activate("/tmp/MENU01.mnudds", sample);
    run();

    const html = stub.window.__lastPanel?.webview.html ?? "";
    assert.ok(html.includes("画面プレビュー"), ".mnudds でプレビューが開かない");
  });

  test(".prtf では何もしない（帳票プレビューと干渉しない）", () => {
    activate("/tmp/X.prtf", "     A          R REC");
    run();

    assert.strictEqual(stub.window.__lastPanel, undefined, "パネルが開いている");
    assert.strictEqual(stub.window.messages.length, 1);
    assert.ok(stub.window.messages[0]?.includes(".dspf"));
  });

  test("エディタが無いときは何もしない", () => {
    stub.window.activeTextEditor = undefined;
    run();
    assert.strictEqual(stub.window.__lastPanel, undefined);
  });
});
