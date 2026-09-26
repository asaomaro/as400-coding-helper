/**
 * F4 プロンプターを本物の VS Code で操作するための常駐ドライバー（探索用）。
 *
 * VS Code（`.vscode-test` の本体・この拡張を開発モードで読む）を起動したまま、HTTP で JS の断片を受け取って実行する。
 * 起動のたびに 30 秒かけずに、1 操作ずつ試して結果（ソース・画面）を見られる。
 *
 *   node driver.mjs [ワークスペース]        # 127.0.0.1:47112 で待つ
 *   curl -s --data-binary @step.js 127.0.0.1:47112/eval
 *
 * 断片は `async (win, web, h) => { ... }` の本体として実行する。
 *   win: VS Code の窓（playwright の Page）
 *   web(): DDS エディタの WebView のフレーム（無ければ null）
 *   h:   補助（sleep・command・shot）
 * 戻り値は JSON で返す。
 */
import { createServer } from "node:http";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const EXT = resolve(HERE, "../../../vscode-extension");
const require = createRequire(join(EXT, "package.json"));
const { _electron } = require("playwright-core");

const WS = resolve(process.argv[2] ?? join(HERE, "ws"));
const WORK = join(EXT, ".vscode-test", "f4-explore");
const SHOTS = join(HERE, "shots");
mkdirSync(join(WORK, "user", "User"), { recursive: true });
mkdirSync(SHOTS, { recursive: true });
writeFileSync(join(WORK, "user", "User", "settings.json"), JSON.stringify({
  "security.workspace.trust.enabled": false, "workbench.startupEditor": "none", "update.mode": "none",
  "telemetry.telemetryLevel": "off", "extensions.autoUpdate": false, "window.zoomLevel": 0,
  "chat.disableAIFeatures": true, "workbench.secondarySideBar.defaultVisibility": "hidden"
}, null, 2));

const vscodeDir = readdirSync(join(EXT, ".vscode-test")).filter(n => n.startsWith("vscode-linux-x64-")).sort().pop();
const RUNTIME_DIR = ["/mnt/wslg/runtime-dir", process.env.XDG_RUNTIME_DIR].find(Boolean);

const app = await _electron.launch({
  executablePath: join(EXT, ".vscode-test", vscodeDir, "code"),
  env: {
    PATH: process.env.PATH, HOME: process.env.HOME, DISPLAY: process.env.DISPLAY ?? ":0",
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY, XDG_RUNTIME_DIR: RUNTIME_DIR, DONT_PROMPT_WSL_INSTALL: "1"
  },
  args: [WS, `--extensionDevelopmentPath=${EXT}`, `--extensions-dir=${join(WORK, "ext")}`, `--user-data-dir=${join(WORK, "user")}`,
    "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-gpu", "--new-window"]
});
const win = await app.firstWindow();
await win.setViewportSize?.({ width: 1600, height: 1000 }).catch(() => undefined);

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function web() {
  for (const frame of win.frames()) {
    try { if (await frame.$(".prompter-form")) return frame; } catch { /* detached */ }
  }
  return null;
}
const h = {
  sleep,
  async command(title) {
    await win.keyboard.press("F1"); await sleep(400);
    await win.keyboard.type(title); await sleep(700);
    await win.keyboard.press("Enter"); await sleep(800);
  },
  async shot(name) { await win.screenshot({ path: join(SHOTS, `${name}.png`) }); return join(SHOTS, `${name}.png`); },
  async source() {
    const f = await web();
    const ed = win.locator(".monaco-editor .view-lines").first(); return (await ed.count()) ? ed.innerText() : null;
  }
};

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
createServer((req, res) => {
  let body = "";
  req.on("data", c => { body += c; });
  req.on("end", async () => {
    try {
      if (req.url === "/quit") { res.end("bye"); await app.close(); process.exit(0); }
      const fn = new AsyncFunction("win", "web", "h", body);
      const out = await fn(win, web, h);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out ?? null, null, 1));
    } catch (error) {
      res.statusCode = 500;
      res.end(String(error?.stack ?? error));
    }
  });
}).listen(47112, "127.0.0.1", () => console.log("driver ready on 127.0.0.1:47112"));
