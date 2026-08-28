/**
 * プロンプター WebView の HTML。**`vscode` を import しない純関数**にしてある。
 *
 * CSP を単体テストで固定できる形にするため——`style-src` に `unsafe-inline` を
 * 入れていないので、HTML の `style="…"` 属性は落ちる。**落ちても例外は出ず、
 * 欄が出たままになる**ので、目視では守れない。表示の切り替えは class で行う。
 *
 * 中身が空なのは意図的。画面は `webview/ui.ts` が `#root` に組み立てる。
 */

export interface PrompterHtmlOptions {
  readonly cspSource: string;
  readonly nonce: string;
  readonly scriptUri: string;
  readonly styleUri: string;
  readonly title: string;
}

export function buildPrompterHtml(options: PrompterHtmlOptions): string {
  const { cspSource, nonce, scriptUri, styleUri, title } = options;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; font-src ${cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${styleUri}">
<title>${escapeHtml(title)}</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/** リクエストごとに作り直す（使い回すと nonce の意味が無くなる）。 */
export function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
