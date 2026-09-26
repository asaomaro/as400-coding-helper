/**
 * 作った画面プログラムを 5250 セッション（ts5250 の Session5250）で実際に動かし、各画面を HTML と PNG に残す。
 *
 *   cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify <このファイル> <手順.json>
 *
 * 手順.json: [{ "cmd": "CALL ASAOLIB/CMPLXR" } | { "type": { "row": 7, "col": 3, "text": "5" } } | { "aid": "Enter" } | { "shot": "名前" } | { "wait": 1000 }]
 * 資格情報は ts5250 の暗号化プロファイルからメモリ上で復号する（出力しない・保存しない）。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TS = process.env.TS5250_DIR ?? "/workspaces/ts5250";
const { Session5250, renderScreenHtml } = await import(join(TS, "packages/tn5250/dist/index.js"));
const { SecretCrypto } = await import(join(TS, "packages/server/dist/secret-crypto.js"));
const require = createRequire(join(HERE, "../../../vscode-extension/package.json"));
const { chromium } = require("playwright-core");

const steps = JSON.parse(readFileSync(process.argv[2], "utf8"));
const OUT = join(HERE, "run");
mkdirSync(OUT, { recursive: true });
const profiles = JSON.parse(readFileSync(join(TS, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const password = SecretCrypto.fromEnv().decrypt(sys.signon.passwordEnc);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rows = s => s.cells.map(r => r.map(c => c.char).join("").replace(/\s+$/, ""));
const log = (...a) => console.log(...a);

const session = await Session5250.connect({
  host: sys.host, ccsid: sys.ccsid, tls: sys.tls, screenSize: "27x132",
  user: sys.signon.user, password,
  warn: w => log("WARN: " + w)
});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
async function shot(name) {
  const snap = session.snapshot();
  const html = renderScreenHtml(snap, { title: name });
  writeFileSync(join(OUT, `${name}.html`), html);
  await page.setContent(html); await sleep(200);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  log(`\n===== ${name} =====`);
  rows(snap).forEach((r, i) => { if (r.trim()) log(String(i + 1).padStart(2) + "|" + r); });
}
async function toCommandLine() {
  for (let i = 0; i < 8; i++) {
    const snap = session.snapshot();
    const cmd = snap.fields.filter(f => !f.protected).slice(-1)[0];
    if (rows(snap).some(r => /選択項目またはコマンド|===>/.test(r)) && cmd) return;
    await session.sendAid("Enter", { timeoutMs: 10000 }).catch(() => {}); await sleep(800);
  }
  rows(session.snapshot()).forEach((r, i) => { if (r.trim()) log(String(i + 1).padStart(2) + "|" + r); });
  throw new Error("コマンド行に届かない");
}

try {
  await sleep(1500);
  // 自動サインオンが効かなければ手でサインオンする
  let snap = session.snapshot();
  if (rows(snap).some(r => /サイン・?オン|Sign On/i.test(r))) {
    const inputs = snap.fields.filter(f => !f.protected);
    session.setField({ index: inputs[0].index }, sys.signon.user);
    session.setField({ index: inputs[1].index }, password);
    await session.sendAid("Enter", { cursor: { row: inputs[0].row, col: inputs[0].col }, timeoutMs: 15000 }); await sleep(800);
  }
  await toCommandLine();
  for (const step of steps) {
    if (step.cmd) {
      await toCommandLine();
      const cf = session.snapshot().fields.filter(f => !f.protected).slice(-1)[0];
      session.setField({ index: cf.index }, step.cmd);
      await session.sendAid("Enter", { cursor: { row: cf.row, col: cf.col }, timeoutMs: 30000 }).catch(e => log("aid: " + e.message));
      await sleep(1200);
    } else if (step.type) {
      const f = session.snapshot().fields.find(x => !x.protected && x.row === step.type.row && x.col <= step.type.col && step.type.col < x.col + x.length)
        ?? session.snapshot().fields.find(x => !x.protected && x.row === step.type.row);
      if (!f) { log(`入力欄が無い: ${JSON.stringify(step.type)}`); continue; }
      session.setField({ index: f.index }, step.type.text);
    } else if (step.aid) {
      const cur = step.cursor ? { cursor: step.cursor } : {};
      await session.sendAid(step.aid, { ...cur, timeoutMs: 20000 }).catch(e => log("aid: " + e.message));
      await sleep(1000);
    } else if (step.shot) {
      await shot(step.shot);
    } else if (step.wait) {
      await sleep(step.wait);
    }
  }
} finally {
  await browser.close();
  try { await session.disconnect(); } catch { /* 既に切れている */ }
}
