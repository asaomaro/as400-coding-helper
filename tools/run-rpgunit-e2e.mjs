#!/usr/bin/env node
/**
 * `tools/run-rpgunit.mjs`（skill `rpgunit-test` の道具）を**実機で**確かめる E2E。
 *
 * 道具を子プロセスとして起動し、終了コード・出力・実機に残ったものを見る。テストソースとテスト対象は
 * VS Code 側の E2E（`vscode-extension/dev/rpgunit-e2e.mjs`）と同じもの（`rpgunit-e2e-fixtures.mjs`）を使う
 * ——2 つの経路が同じ入力で同じ結果を返すことを確かめるため。
 *
 * ## 何を確かめるか
 *
 * 1. 正常（終了コード 1）: `TESTPASS` 合格・`TESTFAIL` 失敗。あわせて `--json` `--xml` `--md` `--keep`
 *    `--check-independence` `--rclrsc always` を渡し、それぞれの成果物と IFS に残した XML を確かめる。
 * 2. 古い `*SRVPGM` が残ったままコンパイルが失敗する（終了コード 2・ジョブログを出す）。
 *    旧版はオブジェクトの有無で成否を見ていたので、ここを「成功」と取り違えた。
 * 3. 対照: バインド指定が無ければ `E2EADD` が解決できずビルド失敗（終了コード 2）。
 * 4. 最寄りの `testing.json` の `bndSrvPgm`（終了コード 0）。
 * 5. git の最上位の `.vscode/testing.json` の `bndDir`（終了コード 0。上端まで遡ること）。
 * 6. `--bnd`（終了コード 0）。
 * 7. 誤った `testing.json`（`bndSrvPgm` が文字列。終了コード 2・コンパイルしない）。
 *
 * 終わったら作ったメンバー・オブジェクト・IFS のファイルを消し、**残っていないことを数えて**確かめる。
 *
 * ## 動かし方
 *
 *   cd vscode-extension && npm run compile     # 道具は共通部品のビルド結果を読む
 *   cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify \
 *     <このリポジトリ>/tools/run-rpgunit-e2e.mjs
 *
 * 資格情報は ts5250 の暗号化プロファイルからメモリ上で復号する（出力しない・保存しない）。スプールは消さない。
 */
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BIND_TEST_SOURCE, CALC, basicSource, bindConfig, cleanUp, connectHostServer, createBindTargets, srvpgmExists
} from "../vscode-extension/dev/rpgunit-e2e-fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, "run-rpgunit.mjs");
const LIB = process.env.AS400_LIB?.toUpperCase();
const IFS = process.env.AS400_IFS_DIR;
if (!LIB || !IFS || !process.env.AS400_SYSTEM) {
  console.error("✗ AS400_SYSTEM / AS400_LIB / AS400_IFS_DIR がありません（ts5250 の --env-file で起動してください）");
  process.exit(2);
}
const MEMBER = "RUE2ETST";
const BIND_MEMBER = "RUE2EBND";
const ORACLE = ["      *  VERIFICATION", "      *  Oracle: fixed values chosen by the e2e (2 = 2 passes, 2 = 3 fails)"];

const host = await connectHostServer();

// 作業場所は一時的な git リポジトリ（testing.json を探す上端が git の最上位であることを確かめるため）
const WORK = mkdtempSync(join(tmpdir(), "rpgunit-e2e-"));
execFileSync("git", ["init", "-q", WORK]);
const SRC_DIR = join(WORK, "src", "QUNITSRC");

/** 作業場所を空にして `files`（相対パス → 中身）だけを置く（.git は残す）。 */
function writeWork(files) {
  rmSync(join(WORK, "src"), { recursive: true, force: true });
  rmSync(join(WORK, ".vscode"), { recursive: true, force: true });
  for (const [relative, text] of Object.entries(files)) {
    const full = join(WORK, relative);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

function tool(source, args = []) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [TOOL, join(SRC_DIR, source), ...args], { encoding: "utf8", env: process.env, timeout: 600000 });
  console.log(`    （${source} ${args.join(" ")} → 終了コード ${r.status}、${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const failures = [];
const expect = (ok, label, detail) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) {
    failures.push(label);
    if (detail) console.log(detail.split("\n").map(l => `      | ${l}`).join("\n"));
  }
};
const dump = r => `--- stdout\n${r.out}\n--- stderr\n${r.err}`;

// PATH_NAME は LOB（ロケーターで返る）なので文字列にして取る
const ifsLeft = async names => (await host.sql(`SELECT CAST(PATH_NAME AS VARCHAR(1024)) AS PATH_NAME FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(
    START_PATH_NAME => '${IFS}', SUBTREE_DIRECTORIES => 'NO'))
    WHERE CAST(PATH_NAME AS VARCHAR(1024)) IN (${names.map(n => `'${IFS}/${n}'`).join(",")})`)).map(r => String(r.PATH_NAME).trim());

try {
  const basic = `${MEMBER}.rpgle`;

  console.log("シナリオ 1: 正常（--json --xml --md --keep --check-independence --rclrsc always）");
  writeWork({ [`src/QUNITSRC/${basic}`]: basicSource(false, ORACLE) });
  const xmlOut = join(WORK, "out.xml");
  const mdOut = join(WORK, "out.md");
  const a = tool(basic, ["--json", "--xml", xmlOut, "--md", mdOut, "--keep", "--check-independence", "--rclrsc", "always"]);
  expect(a.code === 1, "終了コード 1（テスト失敗）", dump(a));
  expect(/"name": "TESTPASS"/.test(a.out) && /"name": "TESTFAIL"/.test(a.out), "--json に 2 件が出る", dump(a));
  expect(a.out.includes("Expected '2', but was '3'."), "TESTFAIL の失敗メッセージが出る");
  expect(/"assertions": \d+/.test(a.out), "--json に assertions が出る（共通部品の解析）");
  expect(/独立性.*一致/.test(a.out), "--check-independence: 正順・逆順で一致", dump(a));
  expect(existsSync(xmlOut) && /<testsuite\b/.test(readFileSync(xmlOut, "latin1")), "--xml に結果 XML が保存される");
  expect(existsSync(mdOut) && readFileSync(mdOut, "utf8").includes("TESTFAIL"), "--md にレポートが出る");
  const kept = await ifsLeft([`${MEMBER}.xml`, `${MEMBER}.src`]);
  expect(kept.length === 2, `--keep: IFS に XML とソースが残る（${kept.join(" ") || "なし"}）`);

  console.log("シナリオ 2: 古い *SRVPGM が残ったままコンパイル失敗");
  expect(await srvpgmExists(host, LIB, MEMBER), "前提: シナリオ 1 の *SRVPGM が残っている");
  writeWork({ [`src/QUNITSRC/${basic}`]: basicSource(true, ORACLE) });
  const b = tool(basic);
  expect(b.code === 2, "終了コード 2（古いテストを走らせない）", dump(b));
  expect(b.err.includes("ビルド失敗"), "ビルド失敗と出る", dump(b));
  // 行ごとの理由はコンパイル・リスト（スプール）にしか出ない。ジョブログに出るのはコンパイルが止まったこと
  expect(/RNS9309/.test(b.err), "ジョブログ（RNS9309: モジュールが作成されなかった）を出す", dump(b));
  expect(!b.out.includes("▸ 実行"), "実行まで進まない");
  // シナリオ 1 が --keep で残した XML は、ビルドが失敗して実行まで進まないので残る（次の実行の前に消える）
  const left = await ifsLeft([`${MEMBER}.src`]);
  expect(left.length === 0, `--keep 無し: 転送したソースを IFS に残さない（${left.join(" ") || "なし"}）`);

  console.log("シナリオ 3〜6: テスト対象のサービスプログラムをバインドする");
  await createBindTargets(host, LIB);
  const bind = `${BIND_MEMBER}.rpgle`;
  const bindFile = `src/QUNITSRC/${bind}`;
  writeWork({ [bindFile]: BIND_TEST_SOURCE });
  const c = tool(bind);
  expect(c.code === 2 && /E2EADD/i.test(c.err), "対照: バインド指定が無ければ E2EADD が解決できずビルド失敗", dump(c));

  writeWork({ [bindFile]: BIND_TEST_SOURCE, "src/QUNITSRC/testing.json": bindConfig("bndSrvPgm") });
  const d = tool(bind);
  expect(d.code === 0, `最寄りの testing.json の bndSrvPgm: ["${CALC}"] で合格`, dump(d));
  expect(d.out.includes(`bndsrvpgm ${CALC}`), "バインド指定を表示する");
  const afterRun = await ifsLeft([`${BIND_MEMBER}.xml`, `${BIND_MEMBER}.src`]);
  expect(afterRun.length === 0, `--keep 無し: 実行後に XML とソースを IFS に残さない（${afterRun.join(" ") || "なし"}）`);

  writeWork({ [bindFile]: BIND_TEST_SOURCE, ".vscode/testing.json": bindConfig("bndDir") });
  const e = tool(bind);
  expect(e.code === 0, "git の最上位の .vscode/testing.json の bndDir で合格（上端まで遡る）", dump(e));

  writeWork({ [bindFile]: BIND_TEST_SOURCE });
  const f = tool(bind, ["--bnd", CALC.toLowerCase()]);
  expect(f.code === 0, "--bnd（修飾なし・小文字）で合格", dump(f));

  console.log("シナリオ 7: 誤った testing.json");
  writeWork({ [bindFile]: BIND_TEST_SOURCE, "src/QUNITSRC/testing.json": JSON.stringify({ rpgunit: { rucrtrpg: { bndSrvPgm: CALC } } }) });
  const g = tool(bind, ["--bnd", CALC]);
  expect(g.code === 2 && g.err.includes("バインド指定が正しくありません") && g.err.includes("testing.json"),
    "終了コード 2、どのファイルが誤りかを出す（--bnd があっても弾く）", dump(g));
  expect(!g.out.includes("▸ 転送"), "コンパイルしない（実機に触らない）");
} finally {
  for (const name of [`${MEMBER}.xml`, `${MEMBER}.src`, `${BIND_MEMBER}.xml`, `${BIND_MEMBER}.src`]) {
    const cmd = await host.hs.CommandConnection.connect({ ...host.creds, resolvePort: true, timeoutMs: 20000 });
    try { await cmd.run(`RMVLNK OBJLNK('${IFS}/${name}')`); } finally { cmd.close(); }
  }
  const leftIfs = await ifsLeft([`${MEMBER}.xml`, `${MEMBER}.src`, `${BIND_MEMBER}.xml`, `${BIND_MEMBER}.src`]);
  const leftLib = await cleanUp(host, LIB, [MEMBER, BIND_MEMBER, CALC]);
  expect(leftIfs.length === 0 && leftLib === 0, `片付け後に実機へ何も残っていない（IFS ${leftIfs.length} / ライブラリー ${leftLib}）`);
  rmSync(WORK, { recursive: true, force: true });
}

console.log(failures.length ? `\nFAILURE（${failures.length} 件）` : "\nSUCCESS");
process.exit(failures.length ? 1 : 0);
