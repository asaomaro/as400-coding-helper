import * as assert from "assert";
import { buildDdsEditorHtml, createNonce } from "../../src/dds/webviewHtml";

/**
 * WebView の HTML と CSP。
 *
 * `style-src` に `unsafe-inline` を入れていないので、HTML の `style="…"` 属性は落ちる。
 * **落ちても例外は出ず、桁だけが静かにずれる**ので目視では守れない。ここで固定する。
 */

const OPTIONS = {
  cspSource: "vscode-resource://test",
  nonce: "NONCE123",
  scriptUri: "vscode-resource://test/out/dds-webview/editor.js",
  styleUri: "vscode-resource://test/out/dds-webview/editor.css",
  title: "CUSTMNT.dspf"
};

suite("エディタ WebView の HTML", () => {
  const html = buildDdsEditorHtml(OPTIONS);

  test("default-src 'none' から始める（既定で全部止める）", () => {
    assert.ok(html.includes("default-src 'none'"));
  });

  test("**style-src に unsafe-inline を入れない**", () => {
    assert.ok(!html.includes("unsafe-inline"));
  });

  test("スクリプトは nonce でだけ許可する", () => {
    assert.ok(html.includes(`script-src 'nonce-${OPTIONS.nonce}'`));
    assert.ok(html.includes(`<script nonce="${OPTIONS.nonce}"`));
  });

  test("HTML に style 属性を書かない（位置指定は CSSOM に寄せる）", () => {
    assert.ok(!/ style="/u.test(html));
  });

  test("束ねた js と css を読み込み、UI の入れ物がある", () => {
    assert.ok(html.includes(`src="${OPTIONS.scriptUri}"`));
    assert.ok(html.includes(`href="${OPTIONS.styleUri}"`));
    assert.ok(html.includes('id="root"'));
  });

  test("題名はエスケープする", () => {
    const escaped = buildDdsEditorHtml({ ...OPTIONS, title: '<img src=x onerror="alert(1)">' });
    assert.ok(!escaped.includes("<img"));
  });
});

suite("nonce", () => {
  test("毎回違う値を返す（使い回さない）", () => {
    assert.notStrictEqual(createNonce(), createNonce());
  });

  test("英数字 32 文字", () => {
    assert.match(createNonce(), /^[A-Za-z0-9]{32}$/u);
  });
});
