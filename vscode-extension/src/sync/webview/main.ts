import "./ui.css";
import { createVsCodeBridge } from "./bridge";
import { startSync } from "./ui";

/** VSCode ホスト向けのエントリ。単独起動版は `dev/sync-standalone.ts`。 */
const root = document.getElementById("root");
if (root !== null) {
  startSync(createVsCodeBridge(), root);
}
