import type { EditorMessage, HostMessage } from "./protocol";

/**
 * ホストとの通信路。**`acquireVsCodeApi` を呼ぶのはこのファイルだけ。**
 * 単独起動ハーネス（`dev/sync-standalone.ts`）は同じ形の実装をもう 1 つ与える。
 */
export interface Bridge {
  post(message: EditorMessage): void;
  onMessage(handler: (message: HostMessage) => void): void;
}

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

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
