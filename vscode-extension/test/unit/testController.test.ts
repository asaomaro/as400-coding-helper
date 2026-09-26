import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import { registerRpgUnitTesting } from "../../src/testing/testController";
import { testLibraryList } from "../../src/testing/suiteRunner";
import type { IbmiTestingConnection } from "../../src/testing/codeForIbmi";

const stub = vscode as unknown as any;

function fakeContext(): vscode.ExtensionContext {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

/** `vscode.tests.createTestController` をスパイし、生成された controller を取り出す。 */
function captureController(): { get: () => any } {
  const original = stub.tests.createTestController;
  let captured: any;
  stub.tests.createTestController = (...args: unknown[]) => {
    captured = original.apply(stub.tests, args);
    return captured;
  };
  return { get: () => captured };
}

function fakeConnection(overrides: Partial<IbmiTestingConnection> = {}): IbmiTestingConnection {
  return {
    uploadMemberContent: async () => true,
    runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
    runCommandSubmitted: async () => ({ completed: true }),
    downloadStreamfile: async () => "",
    writeStreamfile: async () => undefined,
    checkObjectExists: async () => true,
    runSQL: async () => [],
    tempDirectory: "/tmp",
    libraryList: ["QGPL"],
    ...overrides
  };
}

function setupOneTestFile(): void {
  const uri = stub.Uri.file("/ws/src/ASAOLIB/QUNITSRC/CALCTST.rpgle");
  stub.workspace.workspaceFolders = [{ uri: stub.Uri.file("/ws") }];
  stub.workspace.__findFilesResult = [uri];
  stub.workspace.__relativePath = "src/ASAOLIB/QUNITSRC/CALCTST.rpgle";
  stub.workspace.fs.__contents.set(uri.fsPath, "     PTESTADD          B                   EXPORT\n");
}

async function runAll(controller: any): Promise<any> {
  const profile = controller.__runProfiles[0];
  const original = controller.createTestRun;
  let capturedRun: any;
  controller.createTestRun = (...args: unknown[]) => {
    capturedRun = original.apply(controller, args);
    return capturedRun;
  };
  await profile.runHandler({ include: undefined, exclude: undefined }, { isCancellationRequested: false });
  return capturedRun;
}

suite("RPGUnit TestController配線", () => {
  teardown(() => {
    stub.workspace.__findFilesResult = [];
    stub.workspace.fs.__contents.clear();
    stub.workspace.workspaceFolders = undefined;
    stub.workspace.__relativePath = undefined;
    stub.workspace.textDocuments = [];
    stub.workspace.__workspaceFolder = undefined;
    stub.workspace.fs.__existing = [];
  });

  test("resolveHandler がテストソースを検出しTestItemツリーを作る", async () => {
    const holder = captureController();
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: false, reason: "notInstalled" }));
    const controller = holder.get();
    setupOneTestFile();

    await controller.resolveHandler();

    assert.equal(controller.items.size, 1);
    const [, fileItem] = [...controller.items][0];
    assert.equal(fileItem.label, "CALCTST");
    assert.equal(fileItem.children.size, 1);
    const [, procItem] = [...fileItem.children][0];
    assert.equal(procItem.label, "TESTADD");
  });

  test("Runプロファイルが1件だけ登録される", () => {
    const holder = captureController();
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: false, reason: "notInstalled" }));
    const controller = holder.get();
    assert.equal(controller.__runProfiles.length, 1);
    assert.equal(controller.__runProfiles[0].label, "Run");
    assert.equal(controller.__runProfiles[0].kind, vscode.TestRunProfileKind.Run);
  });

  test("接続失敗（notConnected）時は対象の子テストが全て errored になる", async () => {
    const holder = captureController();
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: false, reason: "notConnected" }));
    const controller = holder.get();
    setupOneTestFile();
    await controller.resolveHandler();

    const run = await runAll(controller);
    const errored = run.__calls.filter((c: any) => c.event === "errored");
    assert.equal(errored.length, 1);
    assert.match(errored[0].message.message, /接続/);
  });

  test("コンパイル成功・テスト成功なら run.passed が呼ばれる", async () => {
    const holder = captureController();
    const xml = `<testsuite errors="0" failures="0" name="ASAOLIB/CALCTST" tests="1">
      <testcase name="TESTADD" classname="CALCTST"/>
    </testsuite>`;
    const connection = fakeConnection({ downloadStreamfile: async () => xml });
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: true, connection }));
    const controller = holder.get();
    setupOneTestFile();
    await controller.resolveHandler();

    const run = await runAll(controller);
    assert.ok(run.__calls.some((c: any) => c.event === "passed"));
    assert.equal(run.__calls.filter((c: any) => c.event === "errored").length, 0);
  });

  test("開始前にキャンセル済みなら対象の子テストは skipped になる（enqueuedのまま残さない）", async () => {
    const holder = captureController();
    const connection = fakeConnection();
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: true, connection }));
    const controller = holder.get();
    setupOneTestFile();
    await controller.resolveHandler();

    const profile = controller.__runProfiles[0];
    const original = controller.createTestRun;
    let capturedRun: any;
    controller.createTestRun = (...args: unknown[]) => {
      capturedRun = original.apply(controller, args);
      return capturedRun;
    };
    await profile.runHandler({ include: undefined, exclude: undefined }, { isCancellationRequested: true });

    assert.equal(capturedRun.__calls.filter((c: any) => c.event === "skipped").length, 1);
    assert.equal(capturedRun.__calls.filter((c: any) => c.event === "started").length, 0);
  });

  test("コンパイル失敗（*SRVPGM が作られない）なら errored とコンパイルエラー詳細を報告する", async () => {
    const holder = captureController();
    const connection = fakeConnection({
      checkObjectExists: async () => false,
      runCommand: async (command: string) =>
        command.includes("RUCRTRPG")
          ? { code: -1, stdout: "", stderr: "CPD0043 Keyword not valid" }
          : { code: 0, stdout: "", stderr: "" }
    });
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: true, connection }));
    const controller = holder.get();
    setupOneTestFile();
    await controller.resolveHandler();

    const run = await runAll(controller);
    const errored = run.__calls.filter((c: any) => c.event === "errored");
    assert.equal(errored.length, 1);
    assert.match(errored[0].message.message, /CPD0043/);
  });

  test("テスト失敗（failure）なら run.failed が location 付きで呼ばれる", async () => {
    const holder = captureController();
    const xml = `<testsuite errors="0" failures="1" name="ASAOLIB/CALCTST" tests="1">
      <testcase name="TESTADD" classname="CALCTST">
        <failure message="Expected 3, but was 4.">TESTADD (CALCTST-&gt;CALCTST:900)</failure>
      </testcase>
    </testsuite>`;
    const connection = fakeConnection({ downloadStreamfile: async () => xml });
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: true, connection }));
    const controller = holder.get();
    setupOneTestFile();
    await controller.resolveHandler();

    const run = await runAll(controller);
    const failed = run.__calls.filter((c: any) => c.event === "failed");
    assert.equal(failed.length, 1);
    assert.equal(failed[0].message.message, "Expected 3, but was 4.");
    assert.ok(failed[0].message.location, "location が設定されている");
  });
  test("RUCRTRPG と RUCALLTST は RPGUNIT を先頭にしたライブラリー・リストで実行する", async () => {
    const holder = captureController();
    const calls: { command: string; libraryList?: readonly string[] }[] = [];
    const xml = `<testsuite errors="0" failures="0" name="ASAOLIB/CALCTST" tests="1">
      <testcase name="TESTADD" classname="CALCTST"/>
    </testsuite>`;
    const connection = fakeConnection({
      runCommand: async (command: string, opts?: { libraryList?: readonly string[] }) => {
        calls.push({ command, libraryList: opts?.libraryList });
        return { code: 0, stdout: "", stderr: "" };
      },
      downloadStreamfile: async () => xml
    });
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: true, connection }));
    const controller = holder.get();
    setupOneTestFile();
    await controller.resolveHandler();
    await runAll(controller);

    const create = calls.find(c => c.command.includes("RUCRTRPG"));
    const runTest = calls.find(c => c.command.includes("RUCALLTST"));
    assert.deepEqual(create?.libraryList, ["RPGUNIT", "ASAOLIB", "QGPL"]);
    assert.deepEqual(runTest?.libraryList, ["RPGUNIT", "ASAOLIB", "QGPL"]);
  });

  test("testLibraryList は重複を除き RPGUNIT・対象ライブラリー・利用者の順に並べる", () => {
    assert.deepEqual(testLibraryList("asaolib", ["QGPL", "RPGUNIT", "ASAOLIB"]), ["RPGUNIT", "ASAOLIB", "QGPL"]);
  });

  test("前回の *SRVPGM が残っていても、RUCRTRPG が失敗すれば errored にする", async () => {
    const holder = captureController();
    const connection = fakeConnection({
      checkObjectExists: async () => true,
      runCommand: async (command: string) =>
        command.includes("RUCRTRPG")
          ? { code: 1, stdout: "", stderr: "CPF4102: QINCLUDE not found" }
          : { code: 0, stdout: "", stderr: "" }
    });
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: true, connection }));
    const controller = holder.get();
    setupOneTestFile();
    await controller.resolveHandler();

    const run = await runAll(controller);
    const errored = run.__calls.filter((c: any) => c.event === "errored");
    assert.equal(errored.length, 1);
    assert.match(errored[0].message.message, /CPF4102/);
    assert.equal(run.__calls.filter((c: any) => c.event === "passed").length, 0);
  });

  test("エディターで開いている未保存の内容をアップロードする", async () => {
    const holder = captureController();
    const uploaded: string[] = [];
    const connection = fakeConnection({
      uploadMemberContent: async (_target, content) => { uploaded.push(content); return true; }
    });
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: true, connection }));
    const controller = holder.get();
    setupOneTestFile();
    await controller.resolveHandler();
    const uri = stub.Uri.file("/ws/src/ASAOLIB/QUNITSRC/CALCTST.rpgle");
    stub.workspace.textDocuments = [{ uri, getText: () => "UNSAVED" }];

    await runAll(controller);
    assert.deepEqual(uploaded, ["UNSAVED"]);
  });

  test("実行中に例外が出ても errored にして run を終える", async () => {
    const holder = captureController();
    const connection = fakeConnection({
      uploadMemberContent: async () => { throw new Error("CPF5813 upload failed"); }
    });
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: true, connection }));
    const controller = holder.get();
    setupOneTestFile();
    await controller.resolveHandler();

    const run = await runAll(controller);
    const errored = run.__calls.filter((c: any) => c.event === "errored");
    assert.equal(errored.length, 1);
    assert.match(errored[0].message.message, /CPF5813/);
    assert.equal(run.__calls[run.__calls.length - 1].event, "end");
  });
  test("RUCALLTST の前に前回の結果XMLを消す（古い結果を読まない）", async () => {
    const holder = captureController();
    const commands: string[] = [];
    const xml = `<testsuite errors="0" failures="0" name="ASAOLIB/CALCTST" tests="1">
      <testcase name="TESTADD" classname="CALCTST"/>
    </testsuite>`;
    const connection = fakeConnection({
      runCommand: async (command: string) => { commands.push(command); return { code: 0, stdout: "", stderr: "" }; },
      downloadStreamfile: async () => xml
    });
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: true, connection }));
    const controller = holder.get();
    setupOneTestFile();
    await controller.resolveHandler();
    await runAll(controller);

    const removeBefore = commands.findIndex(c => c.startsWith("QSYS/RMVLNK") && c.includes("CALCTST.xml"));
    const runTest = commands.findIndex(c => c.includes("RUCALLTST"));
    assert.ok(removeBefore >= 0 && removeBefore < runTest, commands.join("\n"));
  });
  /** 2 本のテストファイル（別ディレクトリ）と、それぞれの testing.json を置く。 */
  function setupTwoFilesWithConfigs(configs: Record<string, string>): void {
    const a = stub.Uri.file("/ws/src/ASAOLIB/QUNITSRC/CALCTST.rpgle");
    const b = stub.Uri.file("/ws/src/OTHERLIB/QUNITSRC/OTHTST.rpgle");
    stub.workspace.workspaceFolders = [{ uri: stub.Uri.file("/ws") }];
    stub.workspace.__workspaceFolder = { uri: stub.Uri.file("/ws") };
    stub.workspace.__findFilesResult = [a, b];
    stub.workspace.__relativePath = (uri: any) => uri.fsPath.replace(/^\/ws\//, "");
    stub.workspace.fs.__contents.set(a.fsPath, "     PTESTADD          B                   EXPORT\n");
    stub.workspace.fs.__contents.set(b.fsPath, "     PTESTOTH          B                   EXPORT\n");
    stub.workspace.fs.__existing = Object.keys(configs);
    for (const [path, text] of Object.entries(configs)) {
      stub.workspace.fs.__contents.set(path, text);
    }
  }

  test("testing.json の bndSrvPgm/bndDir をファイルごとに RUCRTRPG へ渡す（別ファイルの値は混ざらない）", async () => {
    const holder = captureController();
    const commands: string[] = [];
    const connection = fakeConnection({
      runCommand: async (command: string) => { commands.push(command); return { code: 0, stdout: "", stderr: "" }; },
      downloadStreamfile: async () => "<testsuite tests=\"0\"></testsuite>"
    });
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: true, connection }));
    const controller = holder.get();
    setupTwoFilesWithConfigs({
      "/ws/src/ASAOLIB/QUNITSRC/testing.json": JSON.stringify({ rpgunit: { rucrtrpg: { bndSrvPgm: ["calcsrv"] } } }),
      "/ws/.vscode/testing.json": JSON.stringify({ rpgunit: { rucrtrpg: { bndDir: ["GLOBALBND"] } } })
    });
    await controller.resolveHandler();
    await runAll(controller);

    const creates = commands.filter(c => c.includes("RUCRTRPG"));
    assert.equal(creates.length, 2);
    const calc = creates.find(c => c.includes("TSTPGM(ASAOLIB/CALCTST)"));
    const other = creates.find(c => c.includes("TSTPGM(OTHERLIB/OTHTST)"));
    assert.match(calc ?? "", /BNDSRVPGM\(CALCSRV\) BNDDIR\(GLOBALBND\)/);
    assert.ok(other && !other.includes("BNDSRVPGM") && other.includes("BNDDIR(GLOBALBND)"), other);
  });

  test("testing.json が誤っていれば、そのファイルだけ errored（パスと理由）にしてアップロードもしない", async () => {
    const holder = captureController();
    const uploaded: string[] = [];
    const connection = fakeConnection({
      uploadMemberContent: async target => { uploaded.push(target.member); return true; },
      downloadStreamfile: async () => `<testsuite errors="0" failures="0" name="X" tests="1">
        <testcase name="TESTOTH" classname="OTHTST"/></testsuite>`
    });
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: true, connection }));
    const controller = holder.get();
    setupTwoFilesWithConfigs({
      "/ws/src/ASAOLIB/QUNITSRC/testing.json": JSON.stringify({ rpgunit: { rucrtrpg: { bndSrvPgm: "CALCSRV" } } })
    });
    await controller.resolveHandler();

    const run = await runAll(controller);
    const errored = run.__calls.filter((c: any) => c.event === "errored");
    assert.equal(errored.length, 1);
    assert.equal(errored[0].item.label, "TESTADD");
    assert.match(errored[0].message.message, /src\/ASAOLIB\/QUNITSRC\/testing\.json/);
    assert.match(errored[0].message.message, /bndSrvPgm は文字列の配列/);
    assert.deepEqual(uploaded, ["OTHTST"]);
    assert.ok(run.__calls.some((c: any) => c.event === "passed" && c.item.label === "TESTOTH"));
  });
});
