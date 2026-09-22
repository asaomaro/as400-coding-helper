import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import { registerRpgUnitTesting } from "../../src/testing/testController";
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
});
