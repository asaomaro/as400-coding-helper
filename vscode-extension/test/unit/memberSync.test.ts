import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import type { Client, ConnectConfig, SFTPWrapper } from "ssh2";
import * as vscode from "vscode";
import {
  createIbmiSourceTransport,
  IbmiSourceSyncError,
  type IbmiSourceSyncSettings,
  type IbmiSourceTransport,
  type UploadAttributes
} from "../../src/sync/ibmiSourceTransport";
import { deriveSourceType, resolveMemberTarget, type MemberTarget } from "../../src/sync/memberTarget";
import {
  findColorSegments,
  VISIBLE_COLOR_MARKERS,
  visibleToWire,
  wireToVisible
} from "../../src/sync/visibleColorMarkers";
import {
  IBMI_SOURCE_SYNC_SECRET_KEY,
  registerMemberSyncCommands
} from "../../src/extension/commands/memberSync";

suite("IBM i source member target", () => {
  test("src の4階層から大文字の IBM i member target を解決する", () => {
    assert.deepEqual(resolveMemberTarget("src/testlib/testsrc/testrpg.rpg"), {
      ok: true,
      target: {
        library: "TESTLIB",
        sourceFile: "TESTSRC",
        member: "TESTRPG",
        extension: "rpg",
        textDescription: undefined
      }
    });
  });

  test("Windows の区切り文字も workspace 相対パスとして受け入れる", () => {
    assert.deepEqual(resolveMemberTarget("src\\testlib\\testsrc\\testrpg.rpgle"), {
      ok: true,
      target: {
        library: "TESTLIB",
        sourceFile: "TESTSRC",
        member: "TESTRPG",
        extension: "rpgle",
        textDescription: undefined
      }
    });
  });

  test("src 配下でない、不完全なパスは pathShape として拒否する", () => {
    for (const path of [
      "other/TESTLIB/TESTSRC/TESTRPG.rpg",
      "src/TESTLIB/TESTSRC/TESTRPG",
      "src/TESTLIB/TESTSRC/.rpg"
    ]) {
      assert.deepEqual(resolveMemberTarget(path), { ok: false, reason: "pathShape" }, path);
    }
  });

  test("拡張子より前に余分な '.' を含む名前はメンバー名に '.' が残り memberName として拒否する", () => {
    assert.deepEqual(resolveMemberTarget("src/TESTLIB/TESTSRC/TEST.RPG.EXTRA"), { ok: false, reason: "memberName" });
  });

  test("最初の '-' でメンバー名とテキスト記述に分割する", () => {
    assert.deepEqual(resolveMemberTarget("src/TESTLIB/TESTSRC/TESTRPG-ITEM_MASTER.rpg"), {
      ok: true,
      target: {
        library: "TESTLIB",
        sourceFile: "TESTSRC",
        member: "TESTRPG",
        extension: "rpg",
        textDescription: "ITEM_MASTER"
      }
    });
  });

  test("'-' の直後が空文字列ならテキスト記述は undefined にする", () => {
    const result = resolveMemberTarget("src/TESTLIB/TESTSRC/TESTRPG-.rpg");
    assert.equal(result.ok, true);
    assert.equal((result as { ok: true; target: { textDescription?: string } }).target.textDescription, undefined);
  });

  test("既存のアンダースコア入りメンバー名は分割されず従来どおり解決される（decisions.md D7）", () => {
    assert.deepEqual(resolveMemberTarget("src/TESTLIB/TESTSRC/MY_PGM.rpg"), {
      ok: true,
      target: {
        library: "TESTLIB",
        sourceFile: "TESTSRC",
        member: "MY_PGM",
        extension: "rpg",
        textDescription: undefined
      }
    });
  });

  test("メンバー名部分（'-' より前）が IBM i object name 規則に違反すれば memberName を返す", () => {
    for (const path of [
      "src/TESTLIB/TESTSRC/TOOLONGMEMBERNAME-desc.rpg",
      "src/TESTLIB/TESTSRC/1STARTSDIGIT-desc.rpg",
      "src/TESTLIB/TESTSRC/BAD.NAME-desc.rpg"
    ]) {
      assert.deepEqual(resolveMemberTarget(path), { ok: false, reason: "memberName" }, path);
    }
  });

  test("テキスト記述が50文字を超えれば textDescription を返す", () => {
    const longDescription = "A".repeat(51);
    assert.deepEqual(
      resolveMemberTarget(`src/TESTLIB/TESTSRC/TESTRPG-${longDescription}.rpg`),
      { ok: false, reason: "textDescription" }
    );
  });

  test("テキスト記述がちょうど50文字なら許容する", () => {
    const description = "A".repeat(50);
    const result = resolveMemberTarget(`src/TESTLIB/TESTSRC/TESTRPG-${description}.rpg`);
    assert.equal(result.ok, true);
    assert.equal((result as { ok: true; target: { textDescription?: string } }).target.textDescription, description);
  });
});

suite("IBM i source type の導出", () => {
  test("TARGET_EXTENSIONS の全拡張子を大文字化する（特例なし。decisions.md D8）", () => {
    for (const extension of ["rpg", "rpgle", "sqlrpgle", "sqlrpg", "clp", "clle", "pf", "lf", "dspf", "prtf", "mnudds", "dds", "cmd"]) {
      const sourceType = deriveSourceType(extension);
      assert.equal(sourceType, extension.toUpperCase());
      assert.ok(sourceType.length <= 10, sourceType);
      assert.match(sourceType, /^[A-Z][A-Z0-9_]*$/u);
    }
  });
});

suite("visible SEU color markers", () => {
  test("7基底色を wire control と marker の間で可逆変換する", () => {
    const wire = VISIBLE_COLOR_MARKERS.map(entry => String.fromCodePoint(entry.wireCodePoint)).join("");
    const visible = VISIBLE_COLOR_MARKERS.map(entry => entry.marker).join("");

    assert.equal(wireToVisible(wire), visible);
    assert.equal(visibleToWire(visible), wire);
    assert.equal(visibleToWire("AŔ顧客"), `A${String.fromCodePoint(0x0088)}顧客`);
  });

  test("未知または修飾済みの control と DBCS 文字を変更しない", () => {
    const modifiedAttribute = String.fromCodePoint(0x0089);
    const text = `顧客${modifiedAttribute}Ŕ`;

    assert.equal(wireToVisible(text), `顧客${modifiedAttribute}Ŕ`);
    assert.equal(visibleToWire(text), `顧客${modifiedAttribute}${String.fromCodePoint(0x0088)}`);
  });

  test("marker 自身から次の marker の直前または行末までを色範囲にする", () => {
    assert.deepEqual(findColorSegments(["ŔABCŶ顧客", "plain", "Ḃ"]), [
      { range: { line: 0, start: 0, end: 4 }, color: "red" },
      { range: { line: 0, start: 4, end: 7 }, color: "yellow" },
      { range: { line: 2, start: 0, end: 1 }, color: "blue" }
    ]);
  });
});

class FakeSftp {
  private closeListener: (() => void) | undefined;

  constructor(
    private readonly events: string[],
    private readonly downloadBytes: Buffer
  ) {}

  once(event: string, listener: () => void): this {
    if (event === "close") {
      this.closeListener = listener;
    }
    return this;
  }

  end(): void {
    this.events.push("sftp:close");
    this.closeListener?.();
  }

  readFile(path: string, callback: (error: Error | undefined, bytes: Buffer) => void): void {
    this.events.push(`sftp:read:${path}`);
    callback(undefined, this.downloadBytes);
  }

  writeFile(path: string, _bytes: Buffer, callback: (error?: Error) => void): void {
    this.events.push(`sftp:write:${path}`);
    callback();
  }

  unlink(path: string, callback: (error?: Error) => void): void {
    this.events.push(`sftp:unlink:${path}`);
    callback();
  }
}

class FakeClient {
  readonly events: string[] = [];
  connectConfig: ConnectConfig | undefined;
  private readonly onceListeners = new Map<string, () => void>();

  once(event: string, listener: () => void): this {
    this.onceListeners.set(event, listener);
    return this;
  }

  connect(config: ConnectConfig): this {
    this.connectConfig = config;
    this.onceListeners.get("ready")?.();
    return this;
  }

  sftp(callback: (error: Error | undefined, sftp?: SFTPWrapper) => void): this {
    callback(
      undefined,
      new FakeSftp(this.events, Buffer.from("A\u0088B\r\n", "utf8")) as unknown as SFTPWrapper
    );
    return this;
  }

  exec(
    command: string,
    callback: (error: Error | undefined, stream?: {
      stderr: { on(event: string, listener: (data: Buffer) => void): void };
      on(event: string, listener: (code: number) => void): void;
    }) => void
  ): this {
    this.events.push(`exec:${command}`);
    callback(undefined, {
      stderr: { on: () => undefined },
      on: (event, listener) => {
        if (event === "close") {
          listener(0);
        }
      }
    });
    return this;
  }

  end(): this {
    this.events.push("client:end");
    return this;
  }
}

const transportSettings: IbmiSourceSyncSettings = {
  host: "ibmi.example.test",
  port: 22,
  user: "TESTUSER",
  authMethod: "password",
  ifsTempDirectory: "/tmp",
  hostKeySha256: createHash("sha256").update(Buffer.from("host-key")).digest("hex")
};

suite("IBM i source transport", () => {
  test("host key fingerprint を接続時に厳密照合する", async () => {
    const client = new FakeClient();
    await createIbmiSourceTransport(
      transportSettings,
      "secret",
      () => client as unknown as Client
    );

    const verifier = client.connectConfig?.hostVerifier as ((key: Buffer) => boolean) | undefined;
    assert.equal(verifier?.(Buffer.from("host-key")), true);
    assert.equal(verifier?.(Buffer.from("different-key")), false);
    assert.equal(client.connectConfig?.password, "secret");
  });

  test("Base64 host key fingerprint は大文字・小文字の違いを許可しない", async () => {
    const hostKey = Buffer.from("host-key");
    const fingerprint = `SHA256:${createHash("sha256").update(hostKey).digest("base64").replace(/=$/u, "")}`;
    const differentCase = `SHA256:${fingerprint.slice(7).replace(/[A-Z]/u, character => character.toLowerCase())}`;

    const matchingClient = new FakeClient();
    await createIbmiSourceTransport(
      { ...transportSettings, hostKeySha256: fingerprint },
      "secret",
      () => matchingClient as unknown as Client
    );
    const matchingVerifier = matchingClient.connectConfig?.hostVerifier as ((key: Buffer) => boolean) | undefined;
    assert.equal(matchingVerifier?.(hostKey), true);

    const differentCaseClient = new FakeClient();
    await createIbmiSourceTransport(
      { ...transportSettings, hostKeySha256: differentCase },
      "secret",
      () => differentCaseClient as unknown as Client
    );
    const differentCaseVerifier = differentCaseClient.connectConfig?.hostVerifier as ((key: Buffer) => boolean) | undefined;
    assert.equal(differentCaseVerifier?.(hostKey), false);
  });

  test("upload は SFTP を閉じてから CPYFRMSTMF、続けて CHGPFM を実行し、最後に IFS を削除する", async () => {
    const client = new FakeClient();
    const transport = await createIbmiSourceTransport(
      transportSettings,
      "secret",
      () => client as unknown as Client
    );
    await transport.upload(
      { library: "TESTLIB", sourceFile: "TESTSRC", member: "TESTMBR", extension: "rpg", textDescription: "ITEM MASTER" },
      "ABC\n",
      { sourceType: "RPG", textDescription: "ITEM MASTER" }
    );

    const copyIndex = client.events.findIndex(event => event.includes("CPYFRMSTMF"));
    const changeIndex = client.events.findIndex(event => event.includes("CHGPFM"));
    const firstClose = client.events.indexOf("sftp:close");
    const cleanupIndex = client.events.findIndex(event => event.startsWith("sftp:unlink:"));
    assert.ok(firstClose >= 0 && firstClose < copyIndex, client.events.join("\n"));
    assert.ok(copyIndex >= 0 && copyIndex < changeIndex, client.events.join("\n"));
    assert.ok(changeIndex >= 0 && changeIndex < cleanupIndex, client.events.join("\n"));
    assert.match(client.events[copyIndex], /DBFCCSID\(\*FILE\)/u);
    assert.match(client.events[copyIndex], /\/QSYS\.LIB\/TESTLIB\.LIB\/TESTSRC\.FILE\/TESTMBR\.MBR/u);
    assert.match(client.events[changeIndex], /CHGPFM FILE\(TESTLIB\/TESTSRC\) MBR\(TESTMBR\) SRCTYPE\(RPG\) TEXT\('ITEM MASTER'\)/u);
  });

  test("upload はテキスト記述が無ければ CHGPFM に TEXT(...) を付けない（既存値を保持）", async () => {
    const client = new FakeClient();
    const transport = await createIbmiSourceTransport(
      transportSettings,
      "secret",
      () => client as unknown as Client
    );
    await transport.upload(
      { library: "TESTLIB", sourceFile: "TESTSRC", member: "TESTMBR", extension: "rpg" },
      "ABC\n",
      { sourceType: "RPG" }
    );

    const changeIndex = client.events.findIndex(event => event.includes("CHGPFM"));
    assert.match(client.events[changeIndex], /CHGPFM FILE\(TESTLIB\/TESTSRC\) MBR\(TESTMBR\) SRCTYPE\(RPG\)"$/u);
  });

  test("upload はテキスト記述内のアポストロフィをエスケープしてから CHGPFM へ渡す", async () => {
    const client = new FakeClient();
    const transport = await createIbmiSourceTransport(
      transportSettings,
      "secret",
      () => client as unknown as Client
    );
    await transport.upload(
      { library: "TESTLIB", sourceFile: "TESTSRC", member: "TESTMBR", extension: "rpg" },
      "ABC\n",
      { sourceType: "RPG", textDescription: "O'BRIEN'S FILE" }
    );

    const changeIndex = client.events.findIndex(event => event.includes("CHGPFM"));
    assert.match(client.events[changeIndex], /TEXT\('O''BRIEN''S FILE'\)/u);
  });

  test("upload はテキスト記述内の remote shell 特殊文字（\\ \" $ `）も CL のアポストロフィと独立にエスケープする", async () => {
    // client.exec() のコマンド文字列は remote 側の login shell が `shell -c '<command>'` として
    // 実行するため、system "..." の外側二重引用符は shell が解釈する（\, ", $, ` が特殊）。
    // CL 文字列リテラルのアポストロフィ二重化だけでは、この層のエスケープにならない（研究 F12、review ラウンド3）。
    const client = new FakeClient();
    const transport = await createIbmiSourceTransport(
      transportSettings,
      "secret",
      () => client as unknown as Client
    );
    const raw = "A\"B$C`D\\E'F";
    await transport.upload(
      { library: "TESTLIB", sourceFile: "TESTSRC", member: "TESTMBR", extension: "rpg" },
      "ABC\n",
      { sourceType: "RPG", textDescription: raw }
    );

    const changeIndex = client.events.findIndex(event => event.includes("CHGPFM"));
    const command = client.events[changeIndex];
    const textMatch = command.match(/TEXT\('([\s\S]*)'\)"$/u);
    assert.ok(textMatch, command);
    const escaped = textMatch![1];

    // remote shell の二重引用符コンテキストで特殊な4文字はすべて `\` で前置されている。
    assert.match(escaped, /\\"/u);
    assert.match(escaped, /\\\$/u);
    assert.match(escaped, /\\`/u);
    assert.match(escaped, /\\\\/u);

    // shell → CL の順で剥がすと元の生文字列に戻る（実際に評価される順序と同じ）。
    const afterShell = escaped.replace(/\\([\\"$`])/gu, "$1");
    const afterCl = afterShell.replace(/''/gu, "'");
    assert.equal(afterCl, raw);
  });

  test("upload は CPYFRMSTMF 失敗時に CHGPFM を実行せず kind: copy で失敗する", async () => {
    class FailingCopyClient extends FakeClient {
      exec(
        command: string,
        callback: (error: Error | undefined, stream?: {
          stderr: { on(event: string, listener: (data: Buffer) => void): void };
          on(event: string, listener: (code: number) => void): void;
        }) => void
      ): this {
        this.events.push(`exec:${command}`);
        const code = command.includes("CPYFRMSTMF") ? 1 : 0;
        callback(undefined, {
          stderr: { on: () => undefined },
          on: (event, listener) => { if (event === "close") { listener(code); } }
        });
        return this;
      }
    }
    const client = new FailingCopyClient();
    const transport = await createIbmiSourceTransport(
      transportSettings,
      "secret",
      () => client as unknown as Client
    );

    await assert.rejects(
      () => transport.upload(
        { library: "TESTLIB", sourceFile: "TESTSRC", member: "TESTMBR", extension: "rpg" },
        "ABC\n",
        { sourceType: "RPG" }
      ),
      (error: unknown) => error instanceof IbmiSourceSyncError && error.kind === "copy"
    );
    assert.ok(!client.events.some(event => event.includes("CHGPFM")), client.events.join("\n"));
  });

  test("upload は CPYFRMSTMF 成功・CHGPFM 失敗時に kind: attributes で失敗する", async () => {
    class FailingChangeClient extends FakeClient {
      exec(
        command: string,
        callback: (error: Error | undefined, stream?: {
          stderr: { on(event: string, listener: (data: Buffer) => void): void };
          on(event: string, listener: (code: number) => void): void;
        }) => void
      ): this {
        this.events.push(`exec:${command}`);
        const code = command.includes("CHGPFM") ? 1 : 0;
        callback(undefined, {
          stderr: { on: () => undefined },
          on: (event, listener) => { if (event === "close") { listener(code); } }
        });
        return this;
      }
    }
    const client = new FailingChangeClient();
    const transport = await createIbmiSourceTransport(
      transportSettings,
      "secret",
      () => client as unknown as Client
    );

    await assert.rejects(
      () => transport.upload(
        { library: "TESTLIB", sourceFile: "TESTSRC", member: "TESTMBR", extension: "rpg" },
        "ABC\n",
        { sourceType: "RPG" }
      ),
      (error: unknown) => error instanceof IbmiSourceSyncError && error.kind === "attributes"
    );
  });

  test("download は CPYTOSTMF、SFTP read、cleanup の順に UTF-8 wire text を返す", async () => {
    const client = new FakeClient();
    const transport = await createIbmiSourceTransport(
      transportSettings,
      "secret",
      () => client as unknown as Client
    );
    const text = await transport.download({ library: "TESTLIB", sourceFile: "TESTSRC", member: "TESTMBR", extension: "rpg" });

    const copyIndex = client.events.findIndex(event => event.includes("CPYTOSTMF"));
    const readIndex = client.events.findIndex(event => event.startsWith("sftp:read:"));
    const cleanupIndex = client.events.findIndex(event => event.startsWith("sftp:unlink:"));
    assert.ok(copyIndex >= 0 && copyIndex < readIndex && readIndex < cleanupIndex, client.events.join("\n"));
    assert.equal(text, "A\u0088B\r\n");
  });

  test("password が無い接続は SSH を開始しない", async () => {
    await assert.rejects(
      () => createIbmiSourceTransport(transportSettings, undefined),
      (error: unknown) => error instanceof IbmiSourceSyncError && error.kind === "configuration"
    );
  });
});

function resetSyncStub(): void {
  const stub = vscode as unknown as any;
  stub.commands.registered.clear();
  stub.window.messages = [];
  stub.window.errors = [];
  stub.window.__showTextDocumentCalls = [];
  stub.workspace.__appliedEdits = [];
  stub.workspace.__applyEditResult = true;
  stub.workspace.__workspaceFolder = { uri: stub.Uri.file("/workspace") };
  stub.workspace.__relativePath = "src/testlib/testsrc/testrpg.rpg";
  stub.__setConfig({
    "rpgClSupport.ibmiSourceSync": {
      host: "ibmi.example.test",
      port: 22,
      user: "TESTUSER",
      authMethod: "password",
      ifsTempDirectory: "/tmp",
      hostKeySha256: transportSettings.hostKeySha256
    }
  });
}

function createDocument(text: string, eol = vscode.EndOfLine.LF, saveResult = true): vscode.TextDocument {
  const lines = text.split(/\r\n|\r|\n/gu);
  return {
    uri: vscode.Uri.file("/workspace/src/testlib/testsrc/testrpg.rpg"),
    languageId: "rpg-fixed",
    eol,
    getText: () => text,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] }),
    save: async () => saveResult
  } as unknown as vscode.TextDocument;
}

function createSyncContext(secret: string | undefined): {
  context: vscode.ExtensionContext;
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  if (secret !== undefined) {
    values.set(IBMI_SOURCE_SYNC_SECRET_KEY, secret);
  }
  return {
    context: {
      subscriptions: [],
      secrets: {
        get: async (key: string) => values.get(key),
        store: async (key: string, value: string) => { values.set(key, value); },
        delete: async (key: string) => { values.delete(key); },
        onDidChange: () => ({ dispose() {} })
      }
    } as unknown as vscode.ExtensionContext,
    values
  };
}

class FakeTransport implements IbmiSourceTransport {
  uploaded: { target: unknown; text: string; attributes: UploadAttributes } | undefined;
  downloaded = "";
  disposed = false;

  async upload(target: MemberTarget, utf8WireText: string, attributes: UploadAttributes): Promise<void> {
    this.uploaded = { target, text: utf8WireText, attributes };
  }

  async download(): Promise<string> {
    return this.downloaded;
  }

  dispose(): void {
    this.disposed = true;
  }
}

suite("IBM i source sync commands", () => {
  test("upload は可視 marker を wire control と LF に変換して現在文書だけを送る", async () => {
    resetSyncStub();
    const stub = vscode as unknown as any;
    const document = createDocument("AŔB\r\n");
    stub.window.activeTextEditor = {
      document,
      viewColumn: vscode.ViewColumn.One,
      selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0))
    };
    const { context } = createSyncContext("password");
    const transport = new FakeTransport();
    registerMemberSyncCommands(context, async () => transport);

    await vscode.commands.executeCommand("rpgClSupport.ibmiSourceSync.upload");

    assert.deepEqual(transport.uploaded, {
      target: { library: "TESTLIB", sourceFile: "TESTSRC", member: "TESTRPG", extension: "rpg", textDescription: undefined },
      text: `A${String.fromCodePoint(0x0088)}B\n`,
      attributes: { sourceType: "RPG", textDescription: undefined }
    });
    assert.equal(transport.disposed, true);
    assert.ok(stub.window.messages.some((message: string) => message.includes("アップロード")));
  });

  test("upload はファイル名のテキスト記述と拡張子由来の SRCTYPE を transport へ渡す", async () => {
    resetSyncStub();
    const stub = vscode as unknown as any;
    stub.workspace.__relativePath = "src/testlib/testsrc/testrpg-item_master.rpgle";
    const document = createDocument("ABC\n");
    stub.window.activeTextEditor = {
      document,
      viewColumn: vscode.ViewColumn.One,
      selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0))
    };
    const { context } = createSyncContext("password");
    const transport = new FakeTransport();
    registerMemberSyncCommands(context, async () => transport);

    await vscode.commands.executeCommand("rpgClSupport.ibmiSourceSync.upload");

    assert.equal(transport.uploaded?.target && (transport.uploaded.target as { member: string }).member, "TESTRPG");
    assert.deepEqual(transport.uploaded?.attributes, { sourceType: "RPGLE", textDescription: "item_master" });
  });

  test("メンバー名の規則に違反するファイル名は接続せずエラーを通知する", async () => {
    resetSyncStub();
    const stub = vscode as unknown as any;
    stub.workspace.__relativePath = "src/testlib/testsrc/toolongmembername-desc.rpg";
    const document = createDocument("ABC\n");
    stub.window.activeTextEditor = {
      document,
      viewColumn: vscode.ViewColumn.One,
      selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0))
    };
    const { context } = createSyncContext("password");
    let factoryCalled = false;
    registerMemberSyncCommands(context, async () => {
      factoryCalled = true;
      return new FakeTransport();
    });

    await vscode.commands.executeCommand("rpgClSupport.ibmiSourceSync.upload");

    assert.equal(factoryCalled, false);
    assert.ok(stub.window.errors.some((message: string) => message.includes("メンバー名")));
  });

  test("テキスト記述が50文字を超えるファイル名は接続せずエラーを通知する", async () => {
    resetSyncStub();
    const stub = vscode as unknown as any;
    stub.workspace.__relativePath = `src/testlib/testsrc/testrpg-${"a".repeat(51)}.rpg`;
    const document = createDocument("ABC\n");
    stub.window.activeTextEditor = {
      document,
      viewColumn: vscode.ViewColumn.One,
      selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0))
    };
    const { context } = createSyncContext("password");
    let factoryCalled = false;
    registerMemberSyncCommands(context, async () => {
      factoryCalled = true;
      return new FakeTransport();
    });

    await vscode.commands.executeCommand("rpgClSupport.ibmiSourceSync.upload");

    assert.equal(factoryCalled, false);
    assert.ok(stub.window.errors.some((message: string) => message.includes("テキスト記述")));
  });

  test("属性反映（CHGPFM）だけが失敗した場合は、内容は反映済みであることが伝わる通知にする", async () => {
    resetSyncStub();
    const stub = vscode as unknown as any;
    const document = createDocument("ABC\n");
    stub.window.activeTextEditor = {
      document,
      viewColumn: vscode.ViewColumn.One,
      selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0))
    };
    const { context } = createSyncContext("password");
    class PartiallyFailingTransport extends FakeTransport {
      async upload(): Promise<void> {
        throw new IbmiSourceSyncError("attributes", "IBM i のメンバー属性の反映コマンドが失敗しました。");
      }
    }
    registerMemberSyncCommands(context, async () => new PartiallyFailingTransport());

    await vscode.commands.executeCommand("rpgClSupport.ibmiSourceSync.upload");

    assert.ok(stub.window.errors.some((message: string) => message.includes("内容はアップロードしましたが")));
  });

  test("download は wire control を marker と元の EOL に戻し、replace と save の後に通知する", async () => {
    resetSyncStub();
    const stub = vscode as unknown as any;
    const document = createDocument("old", vscode.EndOfLine.CRLF);
    stub.window.activeTextEditor = {
      document,
      viewColumn: vscode.ViewColumn.One,
      selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0))
    };
    const { context } = createSyncContext("password");
    const transport = new FakeTransport();
    transport.downloaded = `A${String.fromCodePoint(0x0088)}B\r\n`;
    registerMemberSyncCommands(context, async () => transport);

    await vscode.commands.executeCommand("rpgClSupport.ibmiSourceSync.download");

    assert.equal(stub.workspace.__appliedEdits.length, 1);
    assert.equal(stub.workspace.__appliedEdits[0].edits[0].text, "AŔB\r\n");
    assert.ok(stub.window.messages.some((message: string) => message.includes("ダウンロード")));
    assert.equal(stub.window.__showTextDocumentCalls.length, 1);
  });

  test("password が未登録なら transport を作らず、設定操作を案内する", async () => {
    resetSyncStub();
    const stub = vscode as unknown as any;
    const document = createDocument("A");
    stub.window.activeTextEditor = {
      document,
      viewColumn: vscode.ViewColumn.One,
      selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0))
    };
    const { context } = createSyncContext(undefined);
    let factoryCalled = false;
    registerMemberSyncCommands(context, async () => {
      factoryCalled = true;
      return new FakeTransport();
    });

    await vscode.commands.executeCommand("rpgClSupport.ibmiSourceSync.upload");

    assert.equal(factoryCalled, false);
    assert.ok(stub.window.errors.some((message: string) => message.includes("認証情報を保存")));
  });

  test("download の保存失敗は成功通知にしない", async () => {
    resetSyncStub();
    const stub = vscode as unknown as any;
    const document = createDocument("old", vscode.EndOfLine.LF, false);
    stub.window.activeTextEditor = {
      document,
      viewColumn: vscode.ViewColumn.One,
      selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0))
    };
    const { context } = createSyncContext("password");
    const transport = new FakeTransport();
    transport.downloaded = "new\n";
    registerMemberSyncCommands(context, async () => transport);

    await vscode.commands.executeCommand("rpgClSupport.ibmiSourceSync.download");

    assert.ok(stub.window.errors.some((message: string) => message.includes("保存")));
    assert.ok(!stub.window.messages.some((message: string) => message.includes("ダウンロードしました")));
  });

  test("認証情報の保存と削除は SecretStorage だけを変更する", async () => {
    resetSyncStub();
    const stub = vscode as unknown as any;
    const { context, values } = createSyncContext(undefined);
    stub.window.__inputBoxResult = "password";
    registerMemberSyncCommands(context, async () => new FakeTransport());

    await vscode.commands.executeCommand("rpgClSupport.ibmiSourceSync.setAuthenticationSecret");
    assert.equal(values.get(IBMI_SOURCE_SYNC_SECRET_KEY), "password");
    await vscode.commands.executeCommand("rpgClSupport.ibmiSourceSync.clearAuthenticationSecret");
    assert.equal(values.has(IBMI_SOURCE_SYNC_SECRET_KEY), false);
  });
});
