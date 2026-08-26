/**
 * ホストとの通信路。**`acquireVsCodeApi` を呼ぶのはこのファイルだけ。**
 *
 * UI 本体（`ui.ts`）はこの `Bridge` インターフェースだけを見る。
 * スタンドアロンのホストを載せるときは、同じインターフェースを満たす実装を
 * もう 1 つ書いて差し替えるだけで済む——**ここを崩すと後で全面書き直しになる**
 * （親 plan R4 / design「vscode-extension」表）。
 */

import type { HostMessage, WebviewMessage } from "./protocol";

/** UI から見たホスト。送る / 受けるの 2 つしかない。 */
export interface Bridge {
  /** ホストへ送る。 */
  post(message: WebviewMessage): void;
  /** ホストからのメッセージを受け取る。 */
  onMessage(handler: (message: HostMessage) => void): void;
}

/** VSCode の WebView API。`@types/vscode` は WebView 側の型を持たないので自分で宣言する。 */
interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/**
 * VSCode ホスト向けの `Bridge` を作る。
 *
 * **`acquireVsCodeApi` は 1 度しか呼べない**（2 回目は例外）。
 * そのため呼び出しはこの関数に閉じ、結果を使い回す。
 */
export function createVsCodeBridge(): Bridge {
  const api = acquireVsCodeApi();

  return {
    post(message) {
      api.postMessage(message);
    },
    onMessage(handler) {
      window.addEventListener("message", event => {
        // ホストから来る形だけを通す。UI に生の event を触らせない。
        handler(event.data as HostMessage);
      });
    }
  };
}
