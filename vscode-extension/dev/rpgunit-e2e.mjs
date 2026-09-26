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
 * 3〜5. テスト対象のサービスプログラムを `testing.json` でバインドする（対照: バインド無しでは Errored）。
 * 6〜9. IFS 方式（`*.test.rpgle` を Code for IBM i のデプロイで IFS へ送り、EBCDIC に変換した写しから作る）:
 *    デプロイ先が未設定なら Errored／日本語入りのテストがメンバー方式と同時に正しく判定される／
 *    別ディレクトリのコピー句（日本語リテラル）で Passed・無いコピー句で Errored（対照）／
 *    大文字の接尾辞 `.TEST.RPGLE` の検出と `testing.json` のバインド
 *    （`.aidev/works/20260926-rpgunit-ifs-deploy/design.md` AC1〜AC4・AC6・AC10・AC11）。
 *    デプロイ先と現行ライブラリーはヘルパー拡張が起動ごとに環境変数から設定する。
 *
 * 終わったら作ったメンバー・オブジェクト・デプロイ先を消し、**残っていないことを数えて**確かめる。
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
  BIND_TEST_SOURCE, BNDDIR, CALC, COPY_HEADER, basicSource, bindConfig, cleanUp, connectHostServer, copyTestSource,
  createBindTargets, japaneseSource, srvpgmExists
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
/** IFS 方式と同時に出すメンバー方式のテスト（手続き名を IFS 方式のテストと重ねない）。 */
const MEMBER_ONLY = "RUE2EMBR";
const MEMBER_ONLY_SOURCE = [
  "     H NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)",
  "      /COPY RPGUNIT/QINCLUDE,TESTCASE",
  "     PTESTMBR          B                   EXPORT",
  "     DTESTMBR          PI",
  "     C                   CALLP     assertEqual(1:1)",
  "     PTESTMBR          E",
  ""
].join("\n");
/** IFS 方式のデプロイ先（Code for IBM i のデプロイがここへ送る）と、作られるテスト・プログラム（IBM i Testing と同じ名前の規則）。 */
const DEPLOY_DIR = `${process.env.AS400_IFS_DIR}/rpgunit-e2e-deploy`;
const IFS_PROGRAMS = ["TIFSBASIC", "TIFSCOPY", "TIFSNOCOPY", "TIFSBIND"];

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

// WSLg: ログインのセッションが終わると /run/user/<uid> が消え、VS Code の窓が開かないまま起動が時間切れになる
// （2026-09-26 に実際に起きた）。無ければ WSLg の実行時ディレクトリを使う。
const RUNTIME_DIR = process.env.XDG_RUNTIME_DIR && existsSync(process.env.XDG_RUNTIME_DIR)
  ? process.env.XDG_RUNTIME_DIR
  : existsSync("/mnt/wslg/runtime-dir") ? "/mnt/wslg/runtime-dir" : process.env.XDG_RUNTIME_DIR;

/** VS Code を起動し、全テストを走らせ、行ごとの結果とメッセージを返す。 */
async function runScenario(name, { member, tests, checkLanguage = false, deployDir }) {
  writeFileSync(STATUS, "");
  const app = await _electron.launch({
    executablePath: join(VSC, "code"),
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME,
      DISPLAY: process.env.DISPLAY, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
      XDG_RUNTIME_DIR: RUNTIME_DIR, DONT_PROMPT_WSL_INSTALL: "1",
      E2E_STATUS_FILE: STATUS, E2E_HOST: host.creds.host, E2E_USER: host.creds.user, E2E_PASSWORD: host.creds.password,
      // IFS 方式: テスト・プログラムを作る現行ライブラリーと、デプロイ先（無ければヘルパーが外す）
      E2E_CURLIB: LIB, ...(deployDir ? { E2E_DEPLOY_DIR: deployDir } : {})
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
      // 前のシナリオの結果が「outdated result」として残る（user-data-dir を使い回すため）。今回の結果が全行に揃うまで待つ
      // （メンバー方式が先に終わり、デプロイを挟む IFS 方式がまだ走っていることがある）
      if (labels.length && labels.every(label => /\((Passed|Failed|Errored|Skipped)\)/.test(label) && !/outdated/.test(label))) break;
    }
    // 開くファイルの行（IFS 方式は複数を開くことがある）
    for (const label of Array.isArray(member) ? member : [member]) {
      const fileRow = win.locator(".test-explorer .monaco-list-row", { hasText: label }).first();
      await fileRow.click();
      await win.keyboard.press("ArrowRight");
      await sleep(1500);
    }
    await shot("tree");
    const rows = await win.$$eval(".test-explorer .monaco-list-row", rs => rs.map(r => r.getAttribute("aria-label") ?? ""));

    await command("Test: Show Output");
    await sleep(2500);
    const messages = {};
    // 失敗の詳細は該当の子の行を選んで読む（行を探すのは子の名前で。ファイルの間で名前を重ねないこと）
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
      await win.keyboard.type(`${Array.isArray(member) ? member[0] : member}.rpgle`);
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

  // --- IFS 方式（*.test.rpgle を Code for IBM i のデプロイで IFS へ送り、変換した写しから作る） ---
  const ifsBasic = "test/ifsbasic.test.rpgle";
  const memberOnly = `src/${LIB}/QUNITSRC/${MEMBER_ONLY}.rpgle`;

  console.log("シナリオ 6: IFS 方式・デプロイ先が未設定");
  writeWorkspace({ [ifsBasic]: japaneseSource() });
  const f = await runScenario("6-ifs-no-deploy", { member: "ifsbasic.test.rpgle", tests: ["TESTPASS"] });
  expect(f.rows.includes("TESTPASS (Errored)") && f.rows.includes("TESTFAIL (Errored)"), "未設定なら両方 Errored");
  expect(f.messages.TESTPASS.includes("デプロイ先が設定されていません"), "デプロイ先の設定を促すメッセージが出る");

  console.log("シナリオ 7: IFS 方式・日本語入り（メンバー方式と同時）");
  writeWorkspace({ [ifsBasic]: japaneseSource(), [memberOnly]: MEMBER_ONLY_SOURCE });
  const g = await runScenario("7-ifs-normal", { member: ["ifsbasic.test.rpgle", MEMBER_ONLY], tests: ["TESTPASS", "TESTFAIL"], deployDir: DEPLOY_DIR });
  // IFS 方式の行の aria-label は description（プログラム名）から始まる（画面ではファイル名の横にプログラム名が出る）
  expect(g.rows.some(r => r.startsWith("TIFSBASIC")) && g.rows.some(r => r.startsWith(MEMBER_ONLY)),
    `IFS 方式とメンバー方式の項目が同時に出る（${g.rows.filter(r => !/^TEST/.test(r)).join(" / ")}）`);
  expect(g.rows.includes("TESTPASS (Passed)"), "IFS 方式: TESTPASS（日本語リテラルの比較）が Passed");
  expect(g.rows.includes("TESTFAIL (Failed)"), "IFS 方式: TESTFAIL が Failed");
  expect(g.messages.TESTFAIL.includes("Expected '2', but was '3'."), "IFS 方式: 失敗メッセージがメンバー方式と同じ");
  expect(g.rows.includes("TESTMBR (Passed)"), "同じ実行のメンバー方式のテストも Passed");
  if (!g.rows.includes("TESTPASS (Passed)")) console.log(g.messages.TESTPASS);

  console.log("シナリオ 8: IFS 方式・別ディレクトリのコピー句（日本語リテラル）と対照");
  writeWorkspace({
    "test/ifscopy.test.rpgle": copyTestSource("qcopy/e2ecopy_h.rpgleinc"),
    "qcopy/e2ecopy_h.rpgleinc": COPY_HEADER,
    "test/ifsnocopy.test.rpgle": copyTestSource("qcopy/missing_h.rpgleinc", "TESTMISS")
  });
  const h = await runScenario("8-ifs-copy", { member: ["ifscopy.test.rpgle", "ifsnocopy.test.rpgle"], tests: ["TESTCOPY", "TESTMISS"], deployDir: DEPLOY_DIR });
  expect(h.rows.includes("TESTCOPY (Passed)"), "コピー句を IFS の相対パスで /COPY して Passed");
  expect(h.rows.includes("TESTMISS (Errored)") && h.messages.TESTMISS.includes("コンパイルに失敗しました"),
    "対照: 無いコピー句ならコンパイル失敗で Errored");
  if (!h.rows.includes("TESTCOPY (Passed)")) console.log(h.messages.TESTCOPY);

  console.log("シナリオ 9: IFS 方式・testing.json のバインド（大文字の接尾辞 .TEST.RPGLE）");
  writeWorkspace({ "test/IFSBIND.TEST.RPGLE": BIND_TEST_SOURCE, "test/testing.json": bindConfig("bndSrvPgm") });
  const i = await runScenario("9-ifs-bind", { member: "IFSBIND.TEST.RPGLE", tests: ["TESTADD"], deployDir: DEPLOY_DIR });
  expect(i.rows.some(r => r.startsWith("TIFSBIND")), `大文字の接尾辞も検出される（glob の [tT]…）（${i.rows.join(" / ")}）`);
  expect(i.rows.includes("TESTADD (Passed)"), `IFS 方式でも bndSrvPgm: ["${CALC}"] で Passed`);
  if (!i.rows.includes("TESTADD (Passed)")) console.log(i.messages.TESTADD);
} finally {
  const left = await cleanUp(host, LIB, [MEMBER, BIND_MEMBER, CALC, MEMBER_ONLY, ...IFS_PROGRAMS], [DEPLOY_DIR]);
  expect(left === 0, `片付け後に実機へ何も残っていない（残り ${left}）`);
  rmSync(STATUS, { force: true });
}

console.log(`\nスクリーンショット: ${SHOTS}`);
console.log(failures.length ? `\nFAILURE（${failures.length} 件）` : "\nSUCCESS");
process.exit(failures.length ? 1 : 0);
