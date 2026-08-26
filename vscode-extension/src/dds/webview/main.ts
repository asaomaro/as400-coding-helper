/**
 * WebView のエントリポイント。**ホストの選択はここだけ**にある。
 *
 * スタンドアロンで動かすときは、`createVsCodeBridge()` を別の `Bridge` 実装に
 * 差し替えたエントリをもう 1 つ置く——UI 本体（`ui.ts`）は変更しない。
 */

import "./ui.css";
import { createVsCodeBridge } from "./bridge";
import { startEditor } from "./ui";

const root = document.getElementById("root");
if (root !== null) {
  startEditor(createVsCodeBridge(), root);
}
