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
 * 8〜10. IFS 方式（`*.test.rpgle`。RPG のソースを IFS へ送り、EBCDIC に変換した写しから作る。
 *    `.aidev/works/20260926-rpgunit-ifs-deploy/design.md` AC5・AC8）:
 *    別ディレクトリのコピー句（日本語リテラル）で合格・送ったものを片付ける／日本語入りのテストで終了コード 1（`--keep`）／
 *    対照: `--keep` で残した UTF-8（タグ 1208）の主ソースを直接 `RUCRTRPG SRCSTMF` に渡すと `CPE3490` で開けない。
 *    IFS 方式の作業場所は専用のディレクトリ（`AS400_IFS_DIR` を差し替えて道具に渡す）にして、最後に中身ごと消す。
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
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BIND_TEST_SOURCE, CALC, COPY_HEADER, basicSource, bindConfig, cleanUp, connectHostServer, copyTestSource, createBindTargets,
  japaneseSource, srvpgmExists
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
  for (const dir of ["src", ".vscode", "test", "qcopy"]) rmSync(join(WORK, dir), { recursive: true, force: true });
  for (const [relative, text] of Object.entries(files)) {
    const full = join(WORK, relative);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

function tool(source, args = [], env = {}) {
  const t0 = Date.now();
  const path = source.includes("/") ? join(WORK, source) : join(SRC_DIR, source);
  const r = spawnSync(process.execPath, [TOOL, path, ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 600000 });
  console.log(`    （${source} ${args.join(" ")} → 終了コード ${r.status}、${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const IFS_WORK = `${IFS}/rpgunit-e2e-tool`;

async function ifsCommand(command) {
  const cmd = await host.hs.CommandConnection.connect({ ...host.creds, resolvePort: true, timeoutMs: 60000 });
  try { return await cmd.run(command); } catch { return { success: false }; } finally { cmd.close(); }
}

/** ディレクトリの中にあるものの数（ディレクトリ自身は数えない。無ければ 0）。 */
async function ifsCount(dir) {
  const rows = await host.sql(`SELECT COUNT(*) AS N FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(START_PATH_NAME => '${dir}', SUBTREE_DIRECTORIES => 'YES'))
    WHERE CAST(PATH_NAME AS VARCHAR(1024)) <> '${dir}'`).catch(() => [{ N: 0 }]);
  return Number(rows[0]?.N ?? 0);
}

/** 共通部品を通さずに 1 つのコマンドを SQL ジョブで流し、ジョブログを返す（対照用）。 */
async function directCompile(command) {
  const db = await host.hs.DbConnection.connect({ ...host.creds, resolvePort: true, timeoutMs: 300000 });
  try {
    const last = Number((await host.hs.query(db, "SELECT COALESCE(MAX(ORDINAL_POSITION),0) AS N FROM TABLE(QSYS2.JOBLOG_INFO('*'))")).rows[0].N);
    await host.hs.executeStatement(db, "CALL QSYS2.QCMDEXC(?)", { parameters: [`CHGLIBL LIBL(RPGUNIT ${LIB} QGPL QTEMP) CURLIB(*CRTDFT)`] });
    try {
      await host.hs.executeStatement(db, "CALL QSYS2.QCMDEXC(?)", { parameters: [command] });
      return { ok: true, log: [] };
    } catch {
      const rows = (await host.hs.query(db, `SELECT MESSAGE_ID, MESSAGE_TEXT FROM TABLE(QSYS2.JOBLOG_INFO('*')) WHERE ORDINAL_POSITION > ${last} ORDER BY ORDINAL_POSITION`)).rows;
      return { ok: false, log: rows.map(r => `${r.MESSAGE_ID ?? ""}: ${String(r.MESSAGE_TEXT ?? "").trim()}`) };
    }
  } finally { db.close(); }
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

  // --- IFS 方式 ---
  // 作業場所（送信先・変換した写し・結果 XML）は専用のディレクトリ。道具には AS400_IFS_DIR を差し替えて渡す
  await ifsCommand(`MKDIR DIR('${IFS_WORK}')`);
  const ifsEnv = { AS400_IFS_DIR: IFS_WORK };
  const deployRoot = `${IFS_WORK}/rpgunit/${basename(WORK)}`;

  console.log("シナリオ 8: IFS 方式・別ディレクトリのコピー句（日本語リテラル）");
  writeWork({ "test/ifscopy.test.rpgle": copyTestSource("qcopy/e2ecopy_h.rpgleinc"), "qcopy/e2ecopy_h.rpgleinc": COPY_HEADER });
  const k = tool("test/ifscopy.test.rpgle", [], ifsEnv);
  expect(k.code === 0, "コピー句を IFS の相対パスで /COPY して合格（終了コード 0）", dump(k));
  expect(k.out.includes(`→ ${deployRoot}`) && k.out.includes(`${LIB}/TIFSCOPY`), "送信先と、IBM i Testing と同じ規則のプログラム名を出す", dump(k));
  const afterCopy = await ifsCount(IFS_WORK);
  expect(afterCopy === 0, `--keep 無し: 送ったもの・写し・結果 XML を残さない（残り ${afterCopy}）`);

  console.log("シナリオ 9: IFS 方式・日本語入りのテスト（--keep）");
  writeWork({ "test/ifsbasic.test.rpgle": japaneseSource() });
  const l = tool("test/ifsbasic.test.rpgle", ["--keep"], ifsEnv);
  expect(l.code === 1, "終了コード 1（TESTPASS 合格・TESTFAIL 失敗）", dump(l));
  expect(l.out.includes("Expected '2', but was '3'.") && /2 tests, 1 failure/.test(l.out), "件数と失敗メッセージがメンバー方式と同じ", dump(l));
  const keptSource = `${deployRoot}/test/ifsbasic.test.rpgle`;
  const keptTag = (await host.sql(`SELECT CCSID FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(START_PATH_NAME => '${keptSource}', SUBTREE_DIRECTORIES => 'NO'))`))[0]?.CCSID;
  expect(Number(keptTag) === 1208, `--keep: 送った主ソースが残り、タグは 1208（実際: ${keptTag}）`);

  console.log("シナリオ 10: 対照——UTF-8（タグ 1208）の主ソースを変換せずに RUCRTRPG へ渡す");
  const direct = await directCompile(`RPGUNIT/RUCRTRPG TSTPGM(${LIB}/TIFSRAW) SRCSTMF('${keptSource}') TGTCCSID(0)`);
  expect(!direct.ok && direct.log.some(m => /^CPE3490/.test(m)) && direct.log.some(m => /^RNS9339/.test(m)),
    `CPE3490（変換エラー）・RNS9339（開けない）になる（${direct.log.filter(m => /^(CPE|RNS)/.test(m)).join(" / ") || "なし"}）`);
} finally {
  await ifsCommand(`RMDIR DIR('${IFS_WORK}') SUBTREE(*ALL)`);
  const leftWork = await ifsCount(IFS_WORK);
  expect(leftWork === 0, `IFS 方式の作業場所を消した（残り ${leftWork}）`);
  for (const name of [`${MEMBER}.xml`, `${MEMBER}.src`, `${BIND_MEMBER}.xml`, `${BIND_MEMBER}.src`]) {
    const cmd = await host.hs.CommandConnection.connect({ ...host.creds, resolvePort: true, timeoutMs: 20000 });
    try { await cmd.run(`RMVLNK OBJLNK('${IFS}/${name}')`); } finally { cmd.close(); }
  }
  const leftIfs = await ifsLeft([`${MEMBER}.xml`, `${MEMBER}.src`, `${BIND_MEMBER}.xml`, `${BIND_MEMBER}.src`]);
  const leftLib = await cleanUp(host, LIB, [MEMBER, BIND_MEMBER, CALC, "TIFSCOPY", "TIFSBASIC", "TIFSRAW"]);
  expect(leftIfs.length === 0 && leftLib === 0, `片付け後に実機へ何も残っていない（IFS ${leftIfs.length} / ライブラリー ${leftLib}）`);
  rmSync(WORK, { recursive: true, force: true });
}

console.log(failures.length ? `\nFAILURE（${failures.length} 件）` : "\nSUCCESS");
process.exit(failures.length ? 1 : 0);
