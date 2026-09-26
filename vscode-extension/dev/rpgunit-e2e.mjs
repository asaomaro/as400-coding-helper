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
import {
  BIND_TEST_SOURCE, BNDDIR, CALC, basicSource, bindConfig, cleanUp, connectHostServer, createBindTargets, srvpgmExists
} from "./rpgunit-e2e-fixtures.mjs";

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

const vscodeDir = readdirSync(join(EXT, ".vscode-test")).filter(n => n.startsWith("vscode-linux-x64-")).sort().pop();
if (!vscodeDir || !LIB) {
  console.error("✗ .vscode-test に VS Code 本体が無いか、AS400_LIB が未設定です（ヘッダーの「動かし方」を参照）");
  process.exit(2);
}
const VSC = join(EXT, ".vscode-test", vscodeDir);

// --- 資格情報（メモリのみ）。テストソースとテスト対象は道具の E2E と共有（rpgunit-e2e-fixtures.mjs） ---
const host = await connectHostServer();

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

const BIND_MEMBER = "RUE2EBND";

/** ワークスペースを空にして、`files`（相対パス → 中身）だけを置く。 */
function writeWorkspace(files) {
  rmSync(WS, { recursive: true, force: true });
  for (const [relative, text] of Object.entries(files)) {
    const full = join(WS, relative);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** VS Code を起動し、全テストを走らせ、行ごとの結果とメッセージを返す。 */
async function runScenario(name, { member, tests, checkLanguage = false }) {
  writeFileSync(STATUS, "");
  const app = await _electron.launch({
    executablePath: join(VSC, "code"),
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME,
      DISPLAY: process.env.DISPLAY, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, DONT_PROMPT_WSL_INSTALL: "1",
      E2E_STATUS_FILE: STATUS, E2E_HOST: host.creds.host, E2E_USER: host.creds.user, E2E_PASSWORD: host.creds.password
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
    const fileRow = win.locator(".test-explorer .monaco-list-row", { hasText: member }).first();
    await fileRow.click();
    await win.keyboard.press("ArrowRight");
    await sleep(1500);
    await shot("tree");
    const rows = await win.$$eval(".test-explorer .monaco-list-row", rs => rs.map(r => r.getAttribute("aria-label") ?? ""));

    await command("Test: Show Output");
    await sleep(2500);
    const messages = {};
    for (const test of tests) {
      const row = win.locator(".monaco-list-row", { hasText: test }).last();
      await row.click();
      await sleep(2000);
      // 本文のエディターは表示中の行しか DOM に出ない。先頭を読んだあと、末尾へ移ってもう一度読む
      const top = await win.evaluate(() => document.querySelector(".part.panel")?.innerText ?? "");
      const body = win.locator(".part.panel .monaco-editor").first();
      let bottom = "";
      if (await body.count()) {
        await body.click();
        await win.keyboard.press("Control+End");
        await sleep(800);
        bottom = await win.evaluate(() => document.querySelector(".part.panel")?.innerText ?? "");
      }
      messages[test] = `${top}\n${bottom}`;
    }
    await shot("message");

    let languageMode = "";
    if (checkLanguage) {
      await win.keyboard.press("Control+P");
      await sleep(600);
      await win.keyboard.type(`${member}.rpgle`);
      await sleep(1200);
      await win.keyboard.press("Enter");
      await sleep(3000);
      languageMode = await win.evaluate(() => document.getElementById("status.editor.mode")?.innerText ?? "");
      await shot("editor");
    }
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

const basicPath = `src/${LIB}/QUNITSRC/${MEMBER}.rpgle`;
const bindPath = `src/${LIB}/QUNITSRC/${BIND_MEMBER}.rpgle`;

try {
  console.log("シナリオ 1: 正常");
  writeWorkspace({ [basicPath]: basicSource(false) });
  const a = await runScenario("1-normal", { member: MEMBER, tests: ["TESTPASS", "TESTFAIL"], checkLanguage: true });
  expect(a.rows.includes("TESTPASS (Passed)"), "TESTPASS が Passed");
  expect(a.rows.includes("TESTFAIL (Failed)"), "TESTFAIL が Failed");
  expect(a.messages.TESTFAIL.includes("Expected '2', but was '3'."), "TESTFAIL の失敗メッセージが出る");
  expect(a.languageMode === "RPG Fixed", `.rpgle の言語モードが RPG Fixed のまま（実際: ${a.languageMode}）`);

  console.log("シナリオ 2: 古い *SRVPGM が残ったままコンパイル失敗");
  const stale = await srvpgmExists(host, LIB, MEMBER);
  expect(stale, "前提: シナリオ 1 の *SRVPGM が残っている");
  writeWorkspace({ [basicPath]: basicSource(true) });
  const b = await runScenario("2-stale", { member: MEMBER, tests: ["TESTPASS", "TESTFAIL"] });
  expect(b.rows.includes("TESTPASS (Errored)") && b.rows.includes("TESTFAIL (Errored)"),
    "両方 Errored（古いテストを成功と報告しない）");
  expect(b.messages.TESTPASS.includes("コンパイルに失敗しました"), "コンパイル失敗のメッセージが出る");

  console.log("シナリオ 3〜5: テスト対象のサービスプログラムをバインドする（testing.json）");
  await createBindTargets(host, LIB);
  writeWorkspace({ [bindPath]: BIND_TEST_SOURCE });
  const c = await runScenario("3-no-binding", { member: BIND_MEMBER, tests: ["TESTADD"] });
  expect(c.rows.includes("TESTADD (Errored)"), "対照: testing.json 無しでは Errored");
  // 対照は「正しい理由で」落ちていなければ意味が無い（バインドが無く E2EADD が解決できない）
  const reason = c.messages.TESTADD.split("\n").filter(line => /E2EADD/i.test(line));
  expect(reason.length > 0, `対照の理由がバインドの欠落（E2EADD が解決できない）: ${reason.join(" / ") || "(見つからない)"}`);

  writeWorkspace({ [bindPath]: BIND_TEST_SOURCE, [`src/${LIB}/QUNITSRC/testing.json`]: bindConfig("bndSrvPgm") });
  const d = await runScenario("4-bndsrvpgm", { member: BIND_MEMBER, tests: ["TESTADD"] });
  expect(d.rows.includes("TESTADD (Passed)"), `bndSrvPgm: ["${CALC}"] で Passed`);

  writeWorkspace({ [bindPath]: BIND_TEST_SOURCE, [".vscode/testing.json"]: bindConfig("bndDir") });
  const e = await runScenario("5-bnddir", { member: BIND_MEMBER, tests: ["TESTADD"] });
  expect(e.rows.includes("TESTADD (Passed)"), `bndDir: ["${BNDDIR}"]（.vscode/testing.json）で Passed`);
  if (!e.rows.includes("TESTADD (Passed)")) {
    console.log(e.messages.TESTADD);
  }
  if (!c.rows.includes("TESTADD (Errored)") || !d.rows.includes("TESTADD (Passed)")) {
    console.log(c.messages.TESTADD, "\n---\n", d.messages.TESTADD);
  }
} finally {
  expect(await cleanUp(host, LIB, [MEMBER, BIND_MEMBER, CALC]) === 0, "片付け後に実機へ何も残っていない");
  rmSync(STATUS, { force: true });
}

console.log(`\nスクリーンショット: ${SHOTS}`);
console.log(failures.length ? `\nFAILURE（${failures.length} 件）` : "\nSUCCESS");
process.exit(failures.length ? 1 : 0);
