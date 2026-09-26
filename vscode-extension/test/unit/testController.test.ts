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
    currentLibrary: "CURLIB",
    deploy: async () => ({ ok: true, remoteDirectory: "/home/ASAO/builds/ws" }),
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

  // --- IFS 方式（*.test.rpgle をデプロイした IFS のソースから作る） ---

  const STREAM_XML = `<testsuite errors="0" failures="0" name="CURLIB/TCALC" tests="1">
      <testcase name="TESTADD" classname="TCALC"/>
    </testsuite>`;

  function setupStreamFiles(files: Record<string, string>): void {
    const folder = { uri: stub.Uri.file("/ws"), name: "ws", index: 0 };
    stub.workspace.workspaceFolders = [folder];
    stub.workspace.__workspaceFolder = folder;
    const uris = Object.keys(files).map(relative => stub.Uri.file(`/ws/${relative}`));
    stub.workspace.__findFilesResult = uris;
    const byPath = new Map(Object.keys(files).map(relative => [stub.Uri.file(`/ws/${relative}`).fsPath, relative]));
    stub.workspace.__relativePath = (uri: { fsPath: string }) => byPath.get(uri.fsPath);
    for (const [relative, text] of Object.entries(files)) {
      stub.workspace.fs.__contents.set(stub.Uri.file(`/ws/${relative}`).fsPath, text);
    }
  }

  const TEST_SOURCE = "     PTESTADD          B                   EXPORT\n";

  function recordingConnection(overrides: Partial<IbmiTestingConnection> = {}): {
    connection: IbmiTestingConnection; commands: string[]; deploys: unknown[]; uploads: string[];
  } {
    const commands: string[] = [];
    const deploys: unknown[] = [];
    const uploads: string[] = [];
    const connection = fakeConnection({
      runCommand: async command => { commands.push(command); return { code: 0, stdout: "", stderr: "" }; },
      uploadMemberContent: async target => { uploads.push(target.member); return true; },
      deploy: async folder => { deploys.push(folder.index); return { ok: true, remoteDirectory: "/home/ASAO/builds/ws" }; },
      downloadStreamfile: async () => STREAM_XML,
      ...overrides
    });
    return { connection, commands, deploys, uploads };
  }

  async function runStream(files: Record<string, string>, connection: IbmiTestingConnection): Promise<any> {
    const holder = captureController();
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: true, connection }));
    const controller = holder.get();
    setupStreamFiles(files);
    await controller.resolveHandler();
    return { run: await runAll(controller), controller };
  }

  const erroredMessages = (run: any): string[] =>
    run.__calls.filter((c: any) => c.event === "errored").map((c: any) => c.message.message);

  test("IFS 方式: 項目はファイル名と、description にプログラム名", async () => {
    const holder = captureController();
    registerRpgUnitTesting(fakeContext(), async () => ({ ok: false, reason: "notInstalled" }));
    const controller = holder.get();
    setupStreamFiles({ "test/calc.test.rpgle": TEST_SOURCE, "my.calc.test.rpgle": TEST_SOURCE });
    await controller.resolveHandler();
    const items = [...controller.items].map(([, item]: [string, any]) => [item.label, item.description]);
    assert.deepEqual(items, [["calc.test.rpgle", "TCALC"], ["my.calc.test.rpgle", "プログラム名を作れません"]]);
  });

  test("IFS 方式: デプロイ → 現行ライブラリーに変換した写しから作る → 実行して passed", async () => {
    const { connection, commands, deploys } = recordingConnection();
    const { run } = await runStream({ "test/calc.test.rpgle": TEST_SOURCE }, connection);
    assert.deepEqual(deploys, [0]);
    assert.deepEqual(commands, [
      "CPY OBJ('/home/ASAO/builds/ws/test/calc.test.rpgle') TOOBJ('/tmp/TCALC.rpgle') TOCCSID(*JOBCCSID) DTAFMT(*TEXT) REPLACE(*YES)",
      "RPGUNIT/RUCRTRPG TSTPGM(CURLIB/TCALC) SRCSTMF('/tmp/TCALC.rpgle') " +
        "INCDIR('/home/ASAO/builds/ws/test' '/home/ASAO/builds/ws') TGTCCSID(0)",
      "QSYS/RMVLNK OBJLNK('/tmp/TCALC.rpgle')",
      "QSYS/RMVLNK OBJLNK('/tmp/TCALC.xml')",
      "RPGUNIT/RUCALLTST TSTPGM(CURLIB/TCALC) OUTPUT(*NONE) XMLSTMF('/tmp/TCALC.xml')",
      "QSYS/RMVLNK OBJLNK('/tmp/TCALC.xml')"
    ]);
    assert.ok(run.__calls.some((c: any) => c.event === "passed"));
    assert.deepEqual(erroredMessages(run), []);
  });

  test("IFS 方式: 同じフォルダーのファイルが複数でもデプロイは 1 回。メンバー方式と混在しても両方走る", async () => {
    const { connection, deploys, uploads, commands } = recordingConnection();
    await runStream({
      "test/calc.test.rpgle": TEST_SOURCE,
      "test/other.test.rpgle": TEST_SOURCE,
      "src/ASAOLIB/QUNITSRC/CALCTST.rpgle": TEST_SOURCE
    }, connection);
    assert.deepEqual(deploys, [0]);
    assert.deepEqual(uploads, ["CALCTST"], "メンバー方式はこれまでどおりアップロードする");
    assert.ok(commands.some(c => c.includes("TSTPGM(CURLIB/TCALC)")));
    assert.ok(commands.some(c => c.includes("TSTPGM(CURLIB/TOTHER)")));
    assert.ok(commands.some(c => c.includes("TSTPGM(ASAOLIB/CALCTST) SRCFILE(ASAOLIB/QUNITSRC)")));
  });

  for (const [reason, pattern] of [
    ["notConfigured", /デプロイ先が設定されていません/],
    ["failed", /デプロイに失敗しました/],
    ["unavailable", /デプロイAPIが見つかりません/]
  ] as const) {
    test(`IFS 方式: デプロイが ${reason} なら errored（コンパイルしない）`, async () => {
      const { connection, commands } = recordingConnection({ deploy: async () => ({ ok: false, reason }) });
      const { run } = await runStream({ "test/calc.test.rpgle": TEST_SOURCE }, connection);
      const messages = erroredMessages(run);
      assert.equal(messages.length, 1);
      assert.match(messages[0], pattern);
      assert.deepEqual(commands, []);
    });
  }

  test("IFS 方式: 現行ライブラリーが無ければ errored", async () => {
    const { connection, commands } = recordingConnection({ currentLibrary: undefined });
    const { run } = await runStream({ "test/calc.test.rpgle": TEST_SOURCE }, connection);
    assert.match(erroredMessages(run)[0], /現行ライブラリーがありません/);
    assert.deepEqual(commands, []);
  });

  test("IFS 方式: 名前を作れなければ errored（理由と直し方）", async () => {
    const { connection, commands } = recordingConnection();
    const { run } = await runStream({ "my.calc.test.rpgle": TEST_SOURCE }, connection);
    assert.match(erroredMessages(run)[0], /ファイル名 my\.calc\.test\.rpgle からIBM iのプログラム名を作れません/);
    assert.deepEqual(commands, []);
  });

  test("IFS 方式: 変換に失敗したらデプロイの確認を促す。コンパイル失敗はメンバー方式と同じ文言", async () => {
    const convert = recordingConnection({
      runCommand: async command => ({ code: command.startsWith("CPY ") ? 1 : 0, stdout: "", stderr: "CPFA0A9: オブジェクトが見つからない。" })
    });
    const a = await runStream({ "test/calc.test.rpgle": TEST_SOURCE }, convert.connection);
    assert.match(erroredMessages(a.run)[0], /IFS のソースを変換できません[\s\S]*CPFA0A9[\s\S]*デプロイされているか確認してください/);

    const compile = recordingConnection({
      runCommand: async command => ({ code: command.includes("RUCRTRPG") ? 1 : 0, stdout: "", stderr: "RNS9309: 作成されませんでした。" })
    });
    const b = await runStream({ "test/calc.test.rpgle": TEST_SOURCE }, compile.connection);
    assert.match(erroredMessages(b.run)[0], /^コンパイルに失敗しました。\nRNS9309/);
  });

  test("IFS 方式: 開いているエディターの未保存の内容は使わない（デプロイ先のファイルを変換してコンパイルする）", async () => {
    const { connection, uploads, commands } = recordingConnection();
    let read = 0;
    stub.workspace.textDocuments = [{ uri: stub.Uri.file("/ws/test/calc.test.rpgle"), getText: () => { read += 1; return "unsaved"; } }];
    await runStream({ "test/calc.test.rpgle": TEST_SOURCE }, connection);
    assert.equal(read, 0, "エディターの内容を読まない");
    assert.deepEqual(uploads, [], "メンバーへアップロードしない");
    assert.match(commands[0], /^CPY OBJ\('\/home\/ASAO\/builds\/ws\/test\/calc\.test\.rpgle'\)/);
  });

  test("IFS 方式: デプロイが例外を投げても errored にして run を終え、メンバー方式は走る", async () => {
    const { connection, uploads } = recordingConnection({ deploy: async () => { throw new Error("boom"); } });
    const { run } = await runStream({
      "test/calc.test.rpgle": TEST_SOURCE,
      "src/ASAOLIB/QUNITSRC/CALCTST.rpgle": TEST_SOURCE
    }, connection);
    assert.ok(erroredMessages(run).some(m => /デプロイに失敗しました/.test(m)));
    assert.deepEqual(uploads, ["CALCTST"]);
    assert.ok(run.__calls.some((c: any) => c.event === "end"), "run.end() が呼ばれる");
  });

  test("IFS 方式: testing.json のバインド指定が効く。誤っていればコンパイルしない", async () => {
    const good = recordingConnection();
    stub.workspace.fs.__existing = ["/ws/test/testing.json"];
    await runStream({
      "test/calc.test.rpgle": TEST_SOURCE,
      "test/testing.json": JSON.stringify({ rpgunit: { rucrtrpg: { bndSrvPgm: ["CALCSRV"] } } })
    }, good.connection);
    assert.ok(good.commands.some(c => /RUCRTRPG TSTPGM\(CURLIB\/TCALC\) .* BNDSRVPGM\(CALCSRV\) /.test(c)));

    const bad = recordingConnection();
    const { run } = await runStream({
      "test/calc.test.rpgle": TEST_SOURCE,
      "test/testing.json": JSON.stringify({ rpgunit: { rucrtrpg: { bndSrvPgm: "CALCSRV" } } })
    }, bad.connection);
    assert.match(erroredMessages(run)[0], /testing\.json の設定が正しくありません/);
    assert.deepEqual(bad.commands, []);
  });
});
