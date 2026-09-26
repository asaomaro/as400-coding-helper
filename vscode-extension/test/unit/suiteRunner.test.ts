import { strict as assert } from "node:assert";
import { compileStreamSuite, compileSuite, runSuite, testLibraryList, type SuiteConnection } from "../../src/testing/suiteRunner";
import type { StreamTestTarget } from "../../src/testing/streamTarget";
import type { MemberTarget } from "../../src/sync/memberTarget";

interface Call { readonly kind: string; readonly command?: string; readonly libraryList?: readonly string[] }

function fakeConnection(options: {
  baseLibraryList?: readonly string[];
  fail?: (command: string) => boolean;
  xml?: string | Error;
} = {}): { conn: SuiteConnection; calls: Call[] } {
  const calls: Call[] = [];
  const conn: SuiteConnection = {
    uploadMemberContent: async target => { calls.push({ kind: "upload", command: target.member }); return true; },
    runCommand: async (command, opts) => {
      calls.push({ kind: "command", command, libraryList: opts?.libraryList });
      return options.fail?.(command)
        ? { code: 1, stdout: "", stderr: "CPD5D02: 記号'E2EADD'の定義が見つからない。" }
        : { code: 0, stdout: "", stderr: "" };
    },
    downloadStreamfile: async path => {
      calls.push({ kind: "download", command: path });
      if (options.xml instanceof Error) throw options.xml;
      return options.xml ?? `<testsuite errors="0" failures="0" name="L/T" tests="1"><testcase name="TESTA" classname="T"/></testsuite>`;
    },
    tempDirectory: "/tmp",
    libraryList: options.baseLibraryList ?? ["QGPL", "QTEMP"]
  };
  return { conn, calls };
}

const target: MemberTarget = { library: "ASAOLIB", sourceFile: "QUNITSRC", member: "CALCTST", extension: "rpgle" };
const noBinding = { servicePrograms: [], bindingDirectories: [] };
const program = { library: target.library, program: target.member };

suite("RPGUnit の共通手順（suiteRunner）", () => {
  test("testLibraryList: RPGUNIT・対象・既定リストの順（VS Code は利用者の設定、道具は QGPL・QTEMP）", () => {
    assert.deepEqual(testLibraryList("asaolib", ["QGPL", "QTEMP"]), ["RPGUNIT", "ASAOLIB", "QGPL", "QTEMP"]);
    assert.deepEqual(testLibraryList("ASAOLIB", ["MYLIB", "RPGUNIT", "QGPL"]), ["RPGUNIT", "ASAOLIB", "MYLIB", "QGPL"]);
  });

  test("compileSuite: アップロード → CHGPFM（リスト無し）→ RUCRTRPG（リストとバインド付き）", async () => {
    const { conn, calls } = fakeConnection();
    const r = await compileSuite(conn, {
      target, source: "src", binding: { servicePrograms: ["CALCSRV"], bindingDirectories: ["MYBND"] }
    });
    assert.deepEqual(r, { ok: true });
    assert.equal(calls[0].kind, "upload");
    assert.equal(calls[1].command, "CHGPFM FILE(ASAOLIB/QUNITSRC) MBR(CALCTST) SRCTYPE(RPGLE)");
    assert.equal(calls[1].libraryList, undefined);
    assert.equal(calls[2].command,
      "RPGUNIT/RUCRTRPG TSTPGM(ASAOLIB/CALCTST) SRCFILE(ASAOLIB/QUNITSRC) SRCMBR(CALCTST) " +
      "BNDSRVPGM(CALCSRV) BNDDIR(MYBND) TGTCCSID(0)");
    assert.deepEqual(calls[2].libraryList, ["RPGUNIT", "ASAOLIB", "QGPL", "QTEMP"]);
    assert.equal(calls.length, 3, "オブジェクトの有無など、ほかの問い合わせをしない");
  });

  test("compileSuite: RUCRTRPG が失敗を返せば ok: false とジョブログ（前回の *SRVPGM が残っていても見ない）", async () => {
    const { conn } = fakeConnection({ fail: command => command.includes("RUCRTRPG") });
    const r = await compileSuite(conn, { target, source: "src", binding: noBinding });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.detail, /CPD5D02/);
  });

  test("compileSuite: noTgtCcsid を渡せる", async () => {
    const { conn, calls } = fakeConnection();
    await compileSuite(conn, { target, source: "src", binding: noBinding, noTgtCcsid: true });
    assert.ok(!calls[2].command?.includes("TGTCCSID"));
  });

  test("runSuite: XML を消す → RUCALLTST（リスト付き）→ 取得 → 消す → 解析", async () => {
    const { conn, calls } = fakeConnection();
    const r = await runSuite(conn, { program, order: "reverse", reclaimResources: "always" });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.suite.cases.map(c => c.name), ["TESTA"]);
    assert.deepEqual(calls.map(c => c.command), [
      "QSYS/RMVLNK OBJLNK('/tmp/CALCTST.xml')",
      "RPGUNIT/RUCALLTST TSTPGM(ASAOLIB/CALCTST) OUTPUT(*NONE) XMLSTMF('/tmp/CALCTST.xml') ORDER(*REVERSE) RCLRSC(*ALWAYS)",
      "/tmp/CALCTST.xml",
      "QSYS/RMVLNK OBJLNK('/tmp/CALCTST.xml')"
    ]);
    assert.deepEqual(calls[1].libraryList, ["RPGUNIT", "ASAOLIB", "QGPL", "QTEMP"]);
  });

  test("runSuite: RUCALLTST が失敗を返しても（テスト失敗時の CPF9897）XML で判定する", async () => {
    const { conn } = fakeConnection({
      fail: command => command.includes("RUCALLTST"),
      xml: `<testsuite errors="0" failures="1" name="L/T" tests="1"><testcase name="TESTA" classname="T"><failure message="x">d</failure></testcase></testsuite>`
    });
    const r = await runSuite(conn, { program });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.suite.failures, 1);
  });

  test("runSuite: keepXml なら実行後は消さない（実行前は常に消す）", async () => {
    const { conn, calls } = fakeConnection();
    await runSuite(conn, { program, keepXml: true });
    const removes = calls.filter(c => c.command?.startsWith("QSYS/RMVLNK"));
    assert.equal(removes.length, 1);
    assert.equal(calls.indexOf(removes[0]), 0);
  });

  test("runSuite: XML が取れなければ ok: false", async () => {
    const { conn } = fakeConnection({ xml: new Error("ENOENT") });
    const r = await runSuite(conn, { program });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.detail, /ENOENT/);
  });

  const stream: StreamTestTarget = { relativePath: "test/calc.test.rpgle", extension: "rpgle", program: "TCALC" };
  const streamProgram = { library: "ASAOLIB", program: "TCALC" };

  test("compileStreamSuite: 主ソースを *JOBCCSID へ写す → RUCRTRPG SRCSTMF（INCDIR は元のディレクトリ → 最上位）→ 写しを消す", async () => {
    const { conn, calls } = fakeConnection();
    const r = await compileStreamSuite(conn, {
      program: streamProgram, target: stream, deployRoot: "/home/ASAO/builds/ws/",
      binding: { servicePrograms: ["CALCSRV"], bindingDirectories: [] }
    });
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(calls.map(c => c.command), [
      "CPY OBJ('/home/ASAO/builds/ws/test/calc.test.rpgle') TOOBJ('/tmp/TCALC.rpgle') TOCCSID(*JOBCCSID) DTAFMT(*TEXT) REPLACE(*YES)",
      "RPGUNIT/RUCRTRPG TSTPGM(ASAOLIB/TCALC) SRCSTMF('/tmp/TCALC.rpgle') " +
        "INCDIR('/home/ASAO/builds/ws/test' '/home/ASAO/builds/ws') BNDSRVPGM(CALCSRV) TGTCCSID(0)",
      "QSYS/RMVLNK OBJLNK('/tmp/TCALC.rpgle')"
    ]);
    assert.equal(calls[0].libraryList, undefined, "変換にライブラリー・リストは要らない");
    assert.deepEqual(calls[1].libraryList, ["RPGUNIT", "ASAOLIB", "QGPL", "QTEMP"]);
  });

  test("compileStreamSuite: テストが最上位にあれば INCDIR は 1 つ。拡張子は写しに引き継ぐ（SQLRPGLE）", async () => {
    const { conn, calls } = fakeConnection();
    await compileStreamSuite(conn, {
      program: streamProgram, target: { relativePath: "calc.test.sqlrpgle", extension: "sqlrpgle", program: "TCALC" },
      deployRoot: "/d", binding: noBinding
    });
    assert.match(calls[0].command!, /TOOBJ\('\/tmp\/TCALC\.sqlrpgle'\)/);
    assert.match(calls[1].command!, / INCDIR\('\/d'\) TGTCCSID\(0\)$/);
  });

  test("compileStreamSuite: 展開先が / でも INCDIR に空文字を入れない", async () => {
    const { conn, calls } = fakeConnection();
    await compileStreamSuite(conn, { program: streamProgram, target: stream, deployRoot: "/", binding: noBinding });
    assert.match(calls[0].command!, /^CPY OBJ\('\/test\/calc\.test\.rpgle'\)/);
    assert.match(calls[1].command!, / INCDIR\('\/test' '\/'\) /);
  });

  test("compileStreamSuite: 変換に失敗したら stage convert（コンパイルしない・写しは消す）", async () => {
    const { conn, calls } = fakeConnection({ fail: command => command.startsWith("CPY ") });
    const r = await compileStreamSuite(conn, { program: streamProgram, target: stream, deployRoot: "/d", binding: noBinding });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.stage, "convert");
      assert.match(r.detail, /IFS のソースを変換できません（\/d\/test\/calc\.test\.rpgle）/);
      assert.match(r.detail, /CPD5D02/, "ジョブログを添える");
    }
    assert.ok(!calls.some(c => c.command?.includes("RUCRTRPG")));
    assert.ok(calls.some(c => c.command?.startsWith("QSYS/RMVLNK")));
  });

  test("compileStreamSuite: コンパイルに失敗したら stage compile とジョブログ", async () => {
    const { conn } = fakeConnection({ fail: command => command.includes("RUCRTRPG") });
    const r = await compileStreamSuite(conn, { program: streamProgram, target: stream, deployRoot: "/d", binding: noBinding });
    assert.deepEqual(r, { ok: false, stage: "compile", detail: "CPD5D02: 記号'E2EADD'の定義が見つからない。" });
  });

  test("compileStreamSuite: 写しの RMVLNK が例外でもコンパイルの結果を保つ。keepCopy なら消さない", async () => {
    const { conn } = fakeConnection();
    const throwing: SuiteConnection = {
      ...conn,
      runCommand: async (command, opts) => {
        if (command.startsWith("QSYS/RMVLNK")) {
          throw new Error("socket closed");
        }
        return conn.runCommand(command, opts);
      }
    };
    const r = await compileStreamSuite(throwing, { program: streamProgram, target: stream, deployRoot: "/d", binding: noBinding });
    assert.deepEqual(r, { ok: true });

    const kept = fakeConnection();
    await compileStreamSuite(kept.conn, { program: streamProgram, target: stream, deployRoot: "/d", binding: noBinding, keepCopy: true });
    assert.ok(!kept.calls.some(c => c.command?.startsWith("QSYS/RMVLNK")));
  });
});
