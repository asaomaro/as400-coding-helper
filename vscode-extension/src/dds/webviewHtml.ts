/**
 * WebView の HTML を組み立てる。**`vscode` に触らない純関数**にしてある。
 *
 * ここを分けている理由は 1 つ: **CSP を一度壊しているから**（07 `decisions.md` D9）。
 * `style-src` に `unsafe-inline` を入れていないので、HTML の `style` 属性は落ちる——
 * しかも例外は出ず、**桁だけが静かにずれる**。CSP は目視で守れる類のものではないので、
 * 単体テストで固定できる形にしておく。
 */

/** HTML 組み立ての材料。VSCode 側で解決した URI と nonce を渡す。 */
export interface WebviewHtmlOptions {
  /** `webview.cspSource`。 */
  readonly cspSource: string;
  /** このリクエスト限りの nonce。 */
  readonly nonce: string;
  /** `main.js` の webview URI。 */
  readonly scriptUri: string;
  /** `main.css` の webview URI。 */
  readonly styleUri: string;
}

/**
 * WebView の HTML を返す。
 *
 * **`default-src 'none'` から始める**（既定で全部止め、必要なものだけ開ける）。
 * スクリプトは nonce、スタイルとフォントは webview のリソース元だけ。
 * `unsafe-inline` は入れない——位置指定は UI 側が CSSOM で与える。
 */
export function buildDdsEditorHtml(options: WebviewHtmlOptions): string {
  const { cspSource, nonce, scriptUri, styleUri } = options;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; font-src ${cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${styleUri}">
<title>DDS ビジュアルエディタ</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/**
 * nonce を作る。
 *
 * **リクエストごとに作り直す**（使い回すと nonce の意味が無くなる）。
 * 既存のプロンプター WebView と同じ作法。
 */
export function createNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
