import { strict as assert } from "node:assert";
import * as vscode from "vscode";
import {
  chooseDeployMethod,
  connectViaCodeForIbmi,
  wrapConnection,
  type RawDeployTools,
  type RawIbmiConnection
} from "../../src/testing/codeForIbmi";

const EXTENSION_ID = "halcyontechltd.code-for-ibmi";
const stub = vscode as unknown as { extensions: { __registry: Map<string, unknown> } };

function makeRawConnection(overrides: Partial<RawIbmiConnection> = {}): RawIbmiConnection {
  return {
    runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
    runSQL: async () => [],
    getTempDirectory: () => "/tmp",
    getConfig: () => ({ libraryList: ["QGPL", "ASAOLIB"] }),
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

  test("runCommand に libraryList を渡すと env の &LIBL で Code for IBM i へ渡す", async () => {
    const calls: unknown[] = [];
    const raw = makeRawConnection({
      runCommand: async data => { calls.push(data); return { code: 0, stdout: "", stderr: "" }; }
    });
    const conn = wrapConnection(raw);
    await conn.runCommand("RPGUNIT/RUCRTRPG X", { libraryList: ["RPGUNIT", "ASAOLIB", "QGPL"] });
    await conn.runCommand("CHGPFM X");
    assert.deepEqual(calls, [
      { command: "RPGUNIT/RUCRTRPG X", env: { "&LIBL": "RPGUNIT ASAOLIB QGPL" } },
      { command: "CHGPFM X" }
    ]);
  });

  test("利用者のライブラリー・リストを getConfig から取る", () => {
    assert.deepEqual(wrapConnection(makeRawConnection()).libraryList, ["QGPL", "ASAOLIB"]);
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

  const folder = { uri: vscode.Uri.file("/ws"), name: "ws", index: 2 } as vscode.WorkspaceFolder;

  function fakeDeployTools(overrides: Partial<RawDeployTools> = {}): { tools: RawDeployTools; launched: unknown[][] } {
    const launched: unknown[][] = [];
    const tools: RawDeployTools = {
      getRemoteDeployDirectory: () => "/home/ASAO/builds/ws",
      launchDeploy: async (...args) => { launched.push(args); return { remoteDirectory: "/home/ASAO/builds/ws" }; },
      ...overrides
    };
    return { tools, launched };
  }

  test("deploy: デプロイ API が無ければ unavailable", async () => {
    assert.deepEqual(await wrapConnection(makeRawConnection()).deploy(folder), { ok: false, reason: "unavailable" });
  });

  test("deploy: デプロイ先が未設定なら notConfigured で、launchDeploy を呼ばない（呼ぶとダイアログが出る）", async () => {
    const { tools, launched } = fakeDeployTools({ getRemoteDeployDirectory: () => undefined });
    assert.deepEqual(await wrapConnection(makeRawConnection(), tools).deploy(folder), { ok: false, reason: "notConfigured" });
    assert.equal(launched.length, 0);
  });

  test("deploy: フォルダーの番号と方法を渡し、デプロイ先を返す", async () => {
    const { tools, launched } = fakeDeployTools();
    const raw = makeRawConnection({ remoteFeatures: { md5sum: "/QOpenSys/pkgs/bin/md5sum" } });
    assert.deepEqual(await wrapConnection(raw, tools).deploy(folder), { ok: true, remoteDirectory: "/home/ASAO/builds/ws" });
    assert.deepEqual(launched, [[2, "compare"]]);
  });

  test("deploy: launchDeploy が undefined を返す・例外を投げるなら failed", async () => {
    const none = fakeDeployTools({ launchDeploy: async () => undefined });
    assert.deepEqual(await wrapConnection(makeRawConnection(), none.tools).deploy(folder), { ok: false, reason: "failed" });
    const thrown = fakeDeployTools({ launchDeploy: async () => { throw new Error("Invalid deployment path"); } });
    assert.deepEqual(await wrapConnection(makeRawConnection(), thrown.tools).deploy(folder), { ok: false, reason: "failed" });
  });

  test("chooseDeployMethod: 使える既定の方法なら任せる／無ければ md5sum の有無で compare か all（changed は選ばない）", () => {
    assert.equal(chooseDeployMethod({ defaultDeploymentMethod: "all" }, undefined, false), undefined);
    assert.equal(chooseDeployMethod({ defaultDeploymentMethod: "changed" }, undefined, false), undefined);
    assert.equal(chooseDeployMethod({ defaultDeploymentMethod: "compare" }, { md5sum: "/bin/md5sum" }, false), undefined);
    assert.equal(chooseDeployMethod({ defaultDeploymentMethod: "staged" }, undefined, true), undefined);
    assert.equal(chooseDeployMethod({ defaultDeploymentMethod: "" }, { md5sum: "/bin/md5sum" }, false), "compare");
    assert.equal(chooseDeployMethod({}, { md5sum: undefined }, false), "all");
    assert.equal(chooseDeployMethod({}, undefined, true), "all");
  });

  test("chooseDeployMethod: 使えない既定は渡さない（渡すと Code for IBM i が選択の UI を開いて実行が止まる）", () => {
    assert.equal(chooseDeployMethod({ defaultDeploymentMethod: "compare" }, undefined, false), "all", "md5sum が無い compare");
    assert.equal(chooseDeployMethod({ defaultDeploymentMethod: "unstaged" }, { md5sum: "/bin/md5sum" }, false), "compare", "Git 拡張が無い");
    assert.equal(chooseDeployMethod({ defaultDeploymentMethod: "selected" }, undefined, true), "all", "候補に無い値");
  });

  test("deploy: 使える既定の方法があれば方法を渡さない（Code for IBM i に任せる）", async () => {
    const { tools, launched } = fakeDeployTools();
    const raw = makeRawConnection({ getConfig: () => ({ libraryList: [], defaultDeploymentMethod: "all" }) });
    await wrapConnection(raw, tools).deploy(folder);
    assert.deepEqual(launched, [[2, undefined]]);
  });

  test("currentLibrary: 接続設定の現行ライブラリー（大文字）。空なら undefined", () => {
    const withLib = makeRawConnection({ getConfig: () => ({ libraryList: [], currentLibrary: "asaolib" }) });
    assert.equal(wrapConnection(withLib).currentLibrary, "ASAOLIB");
    const blank = makeRawConnection({ getConfig: () => ({ libraryList: [], currentLibrary: " " }) });
    assert.equal(wrapConnection(blank).currentLibrary, undefined);
    assert.equal(wrapConnection(makeRawConnection()).currentLibrary, undefined);
  });

  test("connectViaCodeForIbmi: exports.deployTools を接続に渡す（無ければメンバー方式だけ動く）", async () => {
    const { tools } = fakeDeployTools();
    stub.extensions.__registry.set(EXTENSION_ID, {
      isActive: true,
      exports: { instance: { getConnection: () => makeRawConnection() }, deployTools: tools }
    });
    const result = await connectViaCodeForIbmi();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(await result.connection.deploy(folder), { ok: true, remoteDirectory: "/home/ASAO/builds/ws" });
    }
  });
});
