import type { EditorMessage, HostMessage } from "./protocol";

/**
 * ホストとの通信路。**`acquireVsCodeApi` を呼ぶのはこのファイルだけ。**
 *
 * UI 本体（`ui.ts`）はこの `Bridge` だけを見る。単独起動のときは同じ形の実装を
 * もう 1 つ与えるだけで済む——**ここが VSCode 依存を閉じ込める継ぎ目**なので、
 * ここに他の VSCode API を足さない。
 */
export interface Bridge {
  post(message: EditorMessage): void;
  onMessage(handler: (message: HostMessage) => void): void;
}

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/**
 * VSCode ホスト向けの `Bridge`。
 *
 * **`acquireVsCodeApi` は 1 度しか呼べない**（2 回目は例外）ので、呼び出しはここに閉じる。
 */
export function createVsCodeBridge(): Bridge {
  const api = acquireVsCodeApi();
  return {
    post(message) {
      api.postMessage(message);
    },
    onMessage(handler) {
      window.addEventListener("message", event => handler(event.data as HostMessage));
    }
  };
}
