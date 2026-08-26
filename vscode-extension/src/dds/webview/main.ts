import "./ui.css";
import { createVsCodeBridge } from "./bridge";
import { startEditor } from "./ui";

/**
 * VSCode ホスト向けのエントリ。**ホストの選択はここだけ**にある。
 *
 * 単独起動版は `dev/standalone.ts` が別の `Bridge` を与えて同じ `startEditor` を呼ぶ——
 * UI 本体は 1 行も変わらない。
 */

const root = document.getElementById("root");
if (root !== null) {
  const bridge = createVsCodeBridge();
  startEditor(bridge, root, {
    // 追加の内容はホスト（拡張）が聞く。UI にフォームを持たせない。
    askItem: (kind, at) =>
      new Promise(resolve => {
        const handler = (event: MessageEvent): void => {
          const data = event.data as { type?: string; item?: Record<string, unknown> | null };
          if (data?.type !== "askItemResult") return;
          window.removeEventListener("message", handler);
          resolve(data.item ?? undefined);
        };
        window.addEventListener("message", handler);
        bridge.post({ type: "askItem", kind, row: at.row, column: at.column });
      })
  });
}
