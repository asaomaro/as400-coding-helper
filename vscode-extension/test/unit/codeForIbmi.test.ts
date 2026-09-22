import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import {
  connectViaCodeForIbmi,
  wrapConnection,
  type RawIbmiConnection
} from "../../src/testing/codeForIbmi";

const EXTENSION_ID = "halcyontechltd.code-for-ibmi";
const stub = vscode as unknown as { extensions: { __registry: Map<string, unknown> } };

function makeRawConnection(overrides: Partial<RawIbmiConnection> = {}): RawIbmiConnection {
  return {
    runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
    runSQL: async () => [],
    getTempDirectory: () => "/tmp",
    content: {
      uploadMemberContent: async () => true,
      downloadStreamfileRaw: async () => new Uint8Array(),
      writeStreamfileRaw: async () => undefined,
      checkObject: async () => true
    },
    ...overrides
  };
}

suite("Code for IBM i 検出adapter", () => {
  teardown(() => {
    stub.extensions.__registry.clear();
  });

  test("拡張機能が未登録なら notInstalled", async () => {
    const result = await connectViaCodeForIbmi();
    assert.deepEqual(result, { ok: false, reason: "notInstalled" });
  });

  test("接続が無ければ notConnected", async () => {
    stub.extensions.__registry.set(EXTENSION_ID, {
      isActive: true,
      exports: { instance: { getConnection: () => undefined } }
    });
    const result = await connectViaCodeForIbmi();
    assert.deepEqual(result, { ok: false, reason: "notConnected" });
  });

  test("接続オブジェクトの形が想定と違えば incompatibleApi", async () => {
    stub.extensions.__registry.set(EXTENSION_ID, {
      isActive: true,
      exports: { instance: { getConnection: () => ({ notWhatWeExpect: true }) } }
    });
    const result = await connectViaCodeForIbmi();
    assert.deepEqual(result, { ok: false, reason: "incompatibleApi" });
  });

  test("未activateなら activate() を呼んでから接続を取得する", async () => {
    let activated = false;
    stub.extensions.__registry.set(EXTENSION_ID, {
      isActive: false,
      exports: undefined,
      activate: async () => {
        activated = true;
        return { instance: { getConnection: () => makeRawConnection() } };
      }
    });
    const result = await connectViaCodeForIbmi();
    assert.equal(activated, true);
    assert.equal(result.ok, true);
  });

  test("接続に成功すれば IbmiTestingConnection を返す", async () => {
    stub.extensions.__registry.set(EXTENSION_ID, {
      isActive: true,
      exports: { instance: { getConnection: () => makeRawConnection() } }
    });
    const result = await connectViaCodeForIbmi();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.connection.tempDirectory, "/tmp");
    }
  });
});

suite("wrapConnection", () => {
  test("uploadMemberContent は target の library/sourceFile/member をそのまま渡す", async () => {
    const calls: unknown[] = [];
    const raw = makeRawConnection({
      content: {
        uploadMemberContent: async (...args: unknown[]) => { calls.push(args); return true; },
        downloadStreamfileRaw: async () => new Uint8Array(),
        writeStreamfileRaw: async () => undefined,
        checkObject: async () => true
      }
    });
    const conn = wrapConnection(raw);
    const ok = await conn.uploadMemberContent(
      { library: "ASAOLIB", sourceFile: "QUNITSRC", member: "CALCTST", extension: "rpgle" },
      "source text"
    );
    assert.equal(ok, true);
    assert.deepEqual(calls, [["ASAOLIB", "QUNITSRC", "CALCTST", "source text"]]);
  });

  test("downloadStreamfile はLatin-1でデコードする", async () => {
    const raw = makeRawConnection({
      content: {
        uploadMemberContent: async () => true,
        downloadStreamfileRaw: async () => new Uint8Array([0x41, 0x42, 0xe9]), // "AB" + Latin-1 'é'
        writeStreamfileRaw: async () => undefined,
        checkObject: async () => true
      }
    });
    const conn = wrapConnection(raw);
    assert.equal(await conn.downloadStreamfile("/tmp/x.xml"), "ABé");
  });

  test("runCommandSubmitted はジョブが消えれば completed=true", async () => {
    let sqlCallCount = 0;
    const raw = makeRawConnection({
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
      runSQL: async () => {
        sqlCallCount += 1;
        return sqlCallCount < 2 ? [{ JOB_NAME: "x" }] : [];
      }
    });
    const conn = wrapConnection(raw);
    // ポーリング間隔(5秒)を待たず終えるため、setTimeoutを即時実行にフックする。
    const originalSetTimeout = global.setTimeout;
    (global as unknown as { setTimeout: typeof setTimeout }).setTimeout =
      ((fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout; }) as typeof setTimeout;
    try {
      const result = await conn.runCommandSubmitted("RPGUNIT/RUCRTRPG ...", { jobNamePrefix: "RUB" });
      assert.deepEqual(result, { completed: true });
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });

  test("runCommandSubmitted は投入自体が失敗すれば completed=false", async () => {
    const raw = makeRawConnection({
      runCommand: async () => ({ code: -1, stdout: "", stderr: "CPF0000" })
    });
    const conn = wrapConnection(raw);
    const result = await conn.runCommandSubmitted("RPGUNIT/RUCRTRPG ...", { jobNamePrefix: "RUB" });
    assert.deepEqual(result, { completed: false });
  });
});
