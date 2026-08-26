import { strict as assert } from "node:assert";
import {
  buildDdsEditorHtml,
  createNonce
} from "../../src/dds/webviewHtml";

const OPTIONS = {
  cspSource: "vscode-resource://test",
  nonce: "NONCE123",
  scriptUri: "vscode-resource://test/dist/webview/main.js",
  styleUri: "vscode-resource://test/dist/webview/main.css"
};

suite("WebView の HTML と CSP", () => {
  const html = buildDdsEditorHtml(OPTIONS);

  test("default-src 'none' から始める（既定で全部止める）", () => {
    assert.ok(html.includes("default-src 'none'"));
  });

  test("**style-src に unsafe-inline を入れない**", () => {
    // ここを緩めると、HTML の style 属性で位置を指定する書き方が通ってしまう。
    // 通ってしまうと、CSP が厳しい環境でだけ桁がずれる（07 decisions D9）。
    assert.ok(!html.includes("unsafe-inline"), "unsafe-inline が入っている");
  });

  test("スクリプトは nonce でだけ許可する", () => {
    assert.ok(html.includes(`script-src 'nonce-${OPTIONS.nonce}'`));
    assert.ok(html.includes(`<script nonce="${OPTIONS.nonce}"`));
  });

  test("スタイルとフォントは webview のリソース元だけ許可する", () => {
    assert.ok(html.includes(`style-src ${OPTIONS.cspSource}`));
    assert.ok(html.includes(`font-src ${OPTIONS.cspSource}`));
  });

  test("バンドルした js と css を読み込む", () => {
    assert.ok(html.includes(`src="${OPTIONS.scriptUri}"`));
    assert.ok(html.includes(`href="${OPTIONS.styleUri}"`));
  });

  test("UI の入れ物（#root）がある", () => {
    assert.ok(html.includes('id="root"'));
  });

  test("HTML に style 属性を書かない（位置指定は CSSOM に寄せる）", () => {
    assert.ok(!/ style="/.test(html), "style 属性が含まれている");
  });
});

suite("nonce", () => {
  test("毎回違う値を返す（使い回さない）", () => {
    assert.notEqual(createNonce(), createNonce());
  });

  test("英数字 32 文字", () => {
    assert.match(createNonce(), /^[A-Za-z0-9]{32}$/);
  });
});
