/**
 * RPGUnit の Test Explorer 統合を、**本物の VS Code・本物の Code for IBM i・実機**で確かめる e2e。
 *
 * ## なぜ要るか
 *
 * 単体テストは VS Code API（`test/support/vscode-stub.js`）も Code for IBM i も偽物で置き換える。
 * 最初の着地（PR #178）はそれで全件緑だったが、実機では **1 件も動かなかった**
 * （`CPF4102`: `RPGUNIT` が `*LIBL` に無く `TESTCASE` の中の `/include` が解決できない）。
 * 偽物の接続はライブラリー・リストを持たないので、単体テストでは原理的に見えない。
 *
 * ## 何を確かめるか（2 シナリオを続けて流し、判定する）
 *
 * 1. 正常: `TESTPASS` が Passed、`TESTFAIL` が Failed（`Expected '2', but was '3'.`）。
 *    あわせて、Code for IBM i と同梱の言語拡張が居ても `.rpgle` の言語モードが `RPG Fixed` のままか。
 * 2. 古い `*SRVPGM` が残ったままコンパイルが失敗する: 両方 Errored になるか
 *    （オブジェクトの有無で成否を見ると「成功」と取り違え、古いテストを走らせてしまう）。
 *
 * 終わったら作ったメンバーとオブジェクトを消し、**残っていないことを数えて**確かめる。
 *
 * ## 動かし方
 *
 *   npm install --no-save playwright-core
 *   npm run compile:all
 *   cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify \
 *     <このリポジトリ>/vscode-extension/dev/rpgunit-e2e.mjs
 *
 * 前提: SR-OSAKA（RPGUnit 導入済み）に SSH で届くこと、`.vscode-test/` に VS Code 本体が
 * あること（`npm run test:integration` を一度走らせると落ちてくる）、WSLg 等のディスプレイ。
 * 資格情報は ts5250 の暗号化プロファイルからメモリ上で復号し、VS Code の環境変数にだけ渡す
 * （出力しない・保存しない）。スプールは消さない。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const EXT = join(HERE, "..");
const require = createRequire(join(EXT, "package.json"));
const { _electron } = require("playwright-core");

const WORK = join(EXT, ".vscode-test", "rpgunit-e2e");
const SHOTS = join(WORK, "shots");
const STATUS = join(WORK, "status.log");
const WS = join(WORK, "ws");
const LIB = process.env.AS400_LIB;
const MEMBER = "RUE2ETST";
const TS5250 = process.env.TS5250_DIR ?? "/workspaces/ts5250";

const vscodeDir = readdirSync(join(EXT, ".vscode-test")).filter(n => n.startsWith("vscode-linux-x64-")).sort().pop();
if (!vscodeDir || !LIB) {
  console.error("✗ .vscode-test に VS Code 本体が無いか、AS400_LIB が未設定です（ヘッダーの「動かし方」を参照）");
  process.exit(2);
}
const VSC = join(EXT, ".vscode-test", vscodeDir);

// --- 資格情報（メモリのみ） ---
const hs = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };

const sql = async statement => {
  const db = await hs.DbConnection.connect({ ...creds, resolvePort: true, timeoutMs: 30000 });
  try { const r = await hs.query(db, statement); return r.rows ?? r; } finally { db.close(); }
};
const srvpgmExists = async () =>
  (await sql(`SELECT OBJNAME FROM TABLE(QSYS2.OBJECT_STATISTICS('${LIB}','*SRVPGM')) WHERE OBJNAME='${MEMBER}'`)).length > 0;

// --- 隔離した拡張ディレクトリに Code for IBM i を入れる（無ければ） ---
const extDir = join(WORK, "ext");
const userDir = join(WORK, "user");
mkdirSync(join(userDir, "User"), { recursive: true });
mkdirSync(SHOTS, { recursive: true });
if (!existsSync(extDir) || !readdirSync(extDir).some(n => n.startsWith("halcyontechltd.code-for-ibmi-"))) {
  execFileSync(join(VSC, "bin", "code"),
    ["--extensions-dir", extDir, "--user-data-dir", userDir, "--install-extension", "halcyontechltd.code-for-ibmi"],
    { env: { ...process.env, DONT_PROMPT_WSL_INSTALL: "1" }, stdio: "inherit" });
}
writeFileSync(join(userDir, "User", "settings.json"), JSON.stringify({
  "security.workspace.trust.enabled": false,
  "workbench.startupEditor": "none",
  "update.mode": "none",
  "telemetry.telemetryLevel": "off",
  "extensions.autoUpdate": false
}, null, 2));

function writeSource(broken) {
  const dir = join(WS, "src", LIB, "QUNITSRC");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${MEMBER}.rpgle`), [
    "     H NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)",
    "      /COPY RPGUNIT/QINCLUDE,TESTCASE",
    "     PTESTPASS         B                   EXPORT",
    "     DTESTPASS         PI",
    "     C                   CALLP     assertEqual(2:2)",
    "     PTESTPASS         E",
    "     PTESTFAIL         B                   EXPORT",
    "     DTESTFAIL         PI",
    broken
      ? "     C                   CALLP     undefinedProc(2:3)"
      : "     C                   CALLP     assertEqual(2:3)",
    "     PTESTFAIL         E",
    ""
  ].join("\n"));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** VS Code を起動し、全テストを走らせ、行ごとの結果とメッセージを返す。 */
async function runScenario(name) {
  writeFileSync(STATUS, "");
  const app = await _electron.launch({
    executablePath: join(VSC, "code"),
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME,
      DISPLAY: process.env.DISPLAY, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, DONT_PROMPT_WSL_INSTALL: "1",
      E2E_STATUS_FILE: STATUS, E2E_HOST: creds.host, E2E_USER: creds.user, E2E_PASSWORD: creds.password
    },
    args: [
      WS,
      `--extensionDevelopmentPath=${EXT}`,
      `--extensionDevelopmentPath=${join(HERE, "rpgunit-e2e-helper")}`,
      `--extensions-dir=${extDir}`,
      `--user-data-dir=${userDir}`,
      "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-gpu", "--new-window"
    ]
  });
  try {
    const win = await app.firstWindow();
    const shot = async label => win.screenshot({ path: join(SHOTS, `${name}-${label}.png`) });
    const command = async title => {
      await win.keyboard.press("F1");
      await sleep(500);
      await win.keyboard.type(title);
      await sleep(800);
      await win.keyboard.press("Enter");
    };

    let status = "";
    for (let i = 0; i < 90 && !status.includes("connect"); i += 1) {
      await sleep(1000);
      status = readFileSync(STATUS, "utf8");
    }
    if (!status.includes('"success":true')) {
      await shot("connect");
      throw new Error(`Code for IBM i で接続できません: ${status.trim() || "(応答なし)"}`);
    }

    await command("View: Show Testing");
    await sleep(4000);
    await command("Test: Run All Tests");
    for (let i = 0; i < 60; i += 1) {
      await sleep(2000);
      const labels = await win.$$eval(".test-explorer .monaco-list-row", rows => rows.map(r => r.getAttribute("aria-label") ?? ""));
      if (labels.some(label => /\((Passed|Failed|Errored)\)/.test(label))) break;
    }
    const fileRow = win.locator(".test-explorer .monaco-list-row", { hasText: MEMBER }).first();
    await fileRow.click();
    await win.keyboard.press("ArrowRight");
    await sleep(1500);
    await shot("tree");
    const rows = await win.$$eval(".test-explorer .monaco-list-row", rs => rs.map(r => r.getAttribute("aria-label") ?? ""));

    await command("Test: Show Output");
    await sleep(2500);
    const messages = {};
    for (const test of ["TESTPASS", "TESTFAIL"]) {
      const row = win.locator(".monaco-list-row", { hasText: test }).last();
      await row.click();
      await sleep(2000);
      messages[test] = await win.evaluate(() => document.querySelector(".part.panel")?.innerText ?? "");
    }
    await shot("message");

    await win.keyboard.press("Control+P");
    await sleep(600);
    await win.keyboard.type(`${MEMBER}.rpgle`);
    await sleep(1200);
    await win.keyboard.press("Enter");
    await sleep(3000);
    const languageMode = await win.evaluate(() => document.getElementById("status.editor.mode")?.innerText ?? "");
    await shot("editor");
    return { rows, messages, languageMode };
  } finally {
    await Promise.race([app.close(), sleep(8000)]);
  }
}

const failures = [];
const expect = (ok, label) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) failures.push(label);
};

try {
  console.log("シナリオ 1: 正常");
  writeSource(false);
  const a = await runScenario("1-normal");
  expect(a.rows.includes("TESTPASS (Passed)"), "TESTPASS が Passed");
  expect(a.rows.includes("TESTFAIL (Failed)"), "TESTFAIL が Failed");
  expect(a.messages.TESTFAIL.includes("Expected '2', but was '3'."), "TESTFAIL の失敗メッセージが出る");
  expect(a.languageMode === "RPG Fixed", `.rpgle の言語モードが RPG Fixed のまま（実際: ${a.languageMode}）`);

  console.log("シナリオ 2: 古い *SRVPGM が残ったままコンパイル失敗");
  const stale = await srvpgmExists();
  expect(stale, "前提: シナリオ 1 の *SRVPGM が残っている");
  writeSource(true);
  const b = await runScenario("2-stale");
  expect(b.rows.includes("TESTPASS (Errored)") && b.rows.includes("TESTFAIL (Errored)"),
    "両方 Errored（古いテストを成功と報告しない）");
  expect(b.messages.TESTPASS.includes("コンパイルに失敗しました"), "コンパイル失敗のメッセージが出る");
} finally {
  const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true, timeoutMs: 20000 });
  try {
    for (const type of ["*SRVPGM", "*MODULE", "*PGM"]) {
      await cmd.run(`DLTOBJ OBJ(${LIB}/${MEMBER}) OBJTYPE(${type})`).catch(() => undefined);
    }
    await cmd.run(`RMVM FILE(${LIB}/QUNITSRC) MBR(${MEMBER})`).catch(() => undefined);
  } finally { cmd.close(); }
  const leftObjects = await sql(`SELECT OBJNAME FROM TABLE(QSYS2.OBJECT_STATISTICS('${LIB}','*ALL')) WHERE OBJNAME='${MEMBER}'`);
  const leftMembers = await sql(`SELECT SYSTEM_TABLE_MEMBER FROM QSYS2.SYSPARTITIONSTAT
    WHERE SYSTEM_TABLE_SCHEMA='${LIB}' AND SYSTEM_TABLE_NAME='QUNITSRC' AND SYSTEM_TABLE_MEMBER='${MEMBER}'`);
  expect(leftObjects.length === 0 && leftMembers.length === 0, "片付け後に実機へ何も残っていない");
  rmSync(STATUS, { force: true });
}

console.log(`\nスクリーンショット: ${SHOTS}`);
console.log(failures.length ? `\nFAILURE（${failures.length} 件）` : "\nSUCCESS");
process.exit(failures.length ? 1 : 0);
