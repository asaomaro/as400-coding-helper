import { createVsCodeBridge } from "./bridge";
import { startPrompter } from "./ui";

/**
 * VSCode ホスト向けのエントリ。**ホストの選択はここだけ**にある。
 *
 * 単独起動版は `dev/prompter-standalone.ts` が別の `Bridge` を与えて
 * 同じ `startPrompter` を呼ぶ——UI 本体は 1 行も変わらない。
 */
const root = document.getElementById("root");
if (root !== null) {
  startPrompter(createVsCodeBridge(), root);
}
