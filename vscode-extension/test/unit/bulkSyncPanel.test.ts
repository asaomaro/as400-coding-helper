import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import * as vscode from "vscode";
import type { RemoteListing, RemoteMember } from "../../src/sync/bulkSync";
import { OPEN_BULK_SYNC_COMMAND, registerBulkSyncCommand } from "../../src/sync/bulkSyncPanel";
import type { IbmiSourceTransport, UploadAttributes } from "../../src/sync/ibmiSourceTransport";
import type { MemberTarget } from "../../src/sync/memberTarget";
import type { HostMessage } from "../../src/sync/webview/protocol";
import { IBMI_SOURCE_SYNC_SECRET_KEY } from "../../src/extension/commands/memberSync";

const stub = vscode as unknown as any;
const FOLDER = "/workspace/src/MYLIB/QRPGSRC";
const at = (text: string): number => Date.parse(`${text}Z`);

class FakeTransport implements IbmiSourceTransport {
  downloads: string[] = [];
  uploads: { target: MemberTarget; text: string; attributes: UploadAttributes }[] = [];
  lists = 0;
  constructor(public listing: RemoteListing, private readonly bodies: Record<string, string> = {}) {}
  async download(target: MemberTarget): Promise<string> {
    this.downloads.push(target.member);
    return this.bodies[target.member] ?? `${target.member}\n`;
  }
  async upload(target: MemberTarget, text: string, attributes: UploadAttributes): Promise<void> {
    this.uploads.push({ target, text, attributes });
  }
  async listMembers(): Promise<RemoteListing> {
    this.lists += 1;
    return this.listing;
  }
  dispose(): void {}
}

const member = (name: string, changed: string, extra: Partial<RemoteMember> = {}): RemoteMember => ({
  name,
  sourceType: "RPGLE",
  text: "",
  lines: 1,
  changed: at(changed),
  ...extra
});

interface Harness {
  transport: FakeTransport;
  posted: HostMessage[];
  modified: [string, number][];
  send(message: unknown): Promise<void>;
  lastState(): Extract<HostMessage, { type: "state" }>;
}

async function open(listing: RemoteListing, bodies: Record<string, string> = {}): Promise<Harness> {
  const transport = new FakeTransport(listing, bodies);
  const modified: [string, number][] = [];
  const secrets = new Map([[IBMI_SOURCE_SYNC_SECRET_KEY, "secret"]]);
  const context = {
    subscriptions: [],
    extensionUri: vscode.Uri.file("/extension"),
    secrets: { get: async (key: string) => secrets.get(key) }
  } as unknown as vscode.ExtensionContext;
  registerBulkSyncCommand(context, {
    transportFactory: async () => transport,
    setModified: async (uri, time) => { modified.push([uri.fsPath, time]); }
  });
  await vscode.commands.executeCommand(OPEN_BULK_SYNC_COMMAND, vscode.Uri.file(FOLDER));
  const panel = stub.window.__lastPanel;
  const posted: HostMessage[] = [];
  panel.webview.postMessage = (message: HostMessage) => { posted.push(message); return Promise.resolve(true); };
  const harness: Harness = {
    transport,
    posted,
    modified,
    send: message => panel.webview.__handler(message),
    lastState: () => [...posted].reverse().find(message => message.type === "state") as Extract<HostMessage, { type: "state" }>
  };
  await harness.send({ type: "ready" });
  return harness;
}

function localFile(name: string, text: string, modified: string): void {
  stub.workspace.fs.__contents.set(`${FOLDER}/${name}`, text);
  stub.workspace.fs.__mtimes.set(`${FOLDER}/${name}`, at(modified));
}

suite("一括の送受信: パネル", () => {
  setup(() => {
    stub.commands.registered.clear();
    stub.window.messages = [];
    stub.window.errors = [];
    stub.window.__warningAnswer = undefined;
    stub.workspace.textDocuments = [];
    stub.workspace.__relativePath = "src/MYLIB/QRPGSRC";
    stub.workspace.fs.__contents.clear();
    stub.workspace.fs.__mtimes.clear();
    stub.workspace.fs.__written = [];
    stub.workspace.fs.__writeThrough = true;
    stub.workspace.fs.__createdDirectories = [];
    stub.__setConfig({
      "rpgClSupport.ibmiSourceSync": {
        host: "ibmi.example.test",
        user: "TESTUSER",
        authMethod: "password",
        ifsTempDirectory: "/tmp",
        hostKeySha256: createHash("sha256").update("k").digest("hex")
      }
    });
  });

  teardown(() => {
    stub.workspace.fs.__writeThrough = false;
    stub.workspace.fs.__contents.clear();
  });

  test("開くと IBM i とフォルダを突き合わせた一覧を画面に送る（ダウンロード向き）", async () => {
    localFile("ORDR01-受注.rpgle", "A\nB\n", "2026-09-27T09:00:00");
    const harness = await open({ exists: true, members: [member("ORDR01", "2026-09-27T10:00:00"), member("NEW", "2026-09-27T10:00:00")] });
    const state = harness.lastState();
    assert.equal(state.sourceFile, "MYLIB/QRPGSRC");
    assert.equal(state.direction, "download");
    assert.deepEqual(state.rows.map(row => [row.name, row.newer, row.target?.fileName, row.target?.lines]), [
      ["NEW", undefined, undefined, undefined],
      ["ORDR01", "source", "ORDR01-受注.rpgle", 2]
    ]);
  });

  test("src/<LIB>/<SRCFILE> でないフォルダでは開かない", async () => {
    stub.workspace.__relativePath = "src/MYLIB";
    registerBulkSyncCommand({ subscriptions: [] } as unknown as vscode.ExtensionContext);
    stub.window.__lastPanel = undefined;
    await vscode.commands.executeCommand(OPEN_BULK_SYNC_COMMAND, vscode.Uri.file("/workspace/src/MYLIB"));
    assert.equal(stub.window.__lastPanel, undefined);
    assert.match(stub.window.errors[0], /src\/<ライブラリー>\/<ソース・ファイル>/u);
  });

  test("ソース・ファイルが無ければ一覧を出さずに理由を出す", async () => {
    const harness = await open({ exists: false, members: [] });
    assert.deepEqual(harness.lastState().rows, []);
    assert.equal(harness.lastState().loaded, false);
    const notice = harness.posted.find(message => message.type === "notice");
    assert.match(notice && notice.type === "notice" ? notice.text : "", /MYLIB\/QRPGSRC がありません/u);
  });

  test("ダウンロードは新しいファイルを メンバー名-記述.タイプ で作り、更新日時を IBM i に揃える", async () => {
    const harness = await open(
      { exists: true, members: [member("NEW", "2026-09-27T10:00:00", { text: "新規", sourceType: "CLLE" })] },
      { NEW: "PGM\n" }
    );
    await harness.send({ type: "transfer", names: ["NEW"] });
    assert.deepEqual(stub.workspace.fs.__written.map((entry: any) => [entry.uri.fsPath, Buffer.from(entry.content).toString("utf8")]), [
      [`${FOLDER}/NEW-新規.clle`, "PGM\n"]
    ]);
    assert.deepEqual(harness.modified, [[`${FOLDER}/NEW-新規.clle`, at("2026-09-27T10:00:00")]]);
    assert.ok(harness.posted.some(message => message.type === "transferred"));
    const notice = [...harness.posted].reverse().find(message => message.type === "notice");
    assert.deepEqual(notice, { type: "notice", kind: "info", text: "1 件をダウンロードしました。" });
  });

  test("既にあるファイルは名前と改行コード（CRLF）を保って上書きする", async () => {
    localFile("A-旧.rpgle", "OLD\r\n", "2026-09-27T09:00:00");
    const harness = await open({ exists: true, members: [member("A", "2026-09-27T10:00:00", { text: "新" })] }, { A: "X\nY\n" });
    await harness.send({ type: "transfer", names: ["A"] });
    const written = stub.workspace.fs.__written[0];
    assert.equal(written.uri.fsPath, `${FOLDER}/A-旧.rpgle`);
    assert.equal(Buffer.from(written.content).toString("utf8"), "X\r\nY\r\n");
  });

  test("転送先の方が新しいものだけ確認し、閉じたら何も転送しない", async () => {
    localFile("NEWER.rpgle", "L\n", "2026-09-27T12:00:00");
    localFile("OLDER.rpgle", "L\n", "2026-09-27T08:00:00");
    const harness = await open({ exists: true, members: [member("NEWER", "2026-09-27T10:00:00"), member("OLDER", "2026-09-27T10:00:00")] });
    await harness.send({ type: "transfer", names: ["NEWER", "OLDER"] });
    assert.equal(stub.window.messages.length, 1);
    assert.match(stub.window.messages[0], /新しいメンバーが 1 件/u);
    assert.deepEqual(harness.transport.downloads, []);
  });

  test("「新しいものを除いて転送」なら転送先が新しいものを外す", async () => {
    localFile("NEWER.rpgle", "L\n", "2026-09-27T12:00:00");
    localFile("OLDER.rpgle", "L\n", "2026-09-27T08:00:00");
    const harness = await open({ exists: true, members: [member("NEWER", "2026-09-27T10:00:00"), member("OLDER", "2026-09-27T10:00:00")] });
    stub.window.__warningAnswer = "新しいものを除いて転送";
    await harness.send({ type: "transfer", names: ["NEWER", "OLDER"] });
    assert.deepEqual(harness.transport.downloads, ["OLDER"]);
  });

  test("「上書きする」なら全部転送する。転送先が古いだけなら確認しない", async () => {
    localFile("NEWER.rpgle", "L\n", "2026-09-27T12:00:00");
    const harness = await open({ exists: true, members: [member("NEWER", "2026-09-27T10:00:00"), member("OLDER", "2026-09-27T10:00:00")] });
    stub.window.__warningAnswer = "上書きする";
    await harness.send({ type: "transfer", names: ["NEWER", "OLDER"] });
    assert.deepEqual(harness.transport.downloads, ["NEWER", "OLDER"]);

    stub.window.messages = [];
    await harness.send({ type: "transfer", names: ["OLDER"] });
    assert.equal(stub.window.messages.length, 0);
  });

  test("未保存の変更がある文書は転送せず理由を出す", async () => {
    localFile("A.rpgle", "L\n", "2026-09-27T08:00:00");
    stub.workspace.textDocuments = [{ uri: vscode.Uri.file(`${FOLDER}/A.rpgle`), isDirty: true }];
    const harness = await open({ exists: true, members: [member("A", "2026-09-27T10:00:00")] });
    await harness.send({ type: "transfer", names: ["A"] });
    assert.deepEqual(harness.transport.downloads, []);
    const notice = [...harness.posted].reverse().find(message => message.type === "notice");
    assert.match(notice && notice.type === "notice" ? notice.text : "", /A: 未保存の変更があります/u);
  });

  test("アップロードはファイル名の記述と拡張子を属性にし、LF の wire で送り、送った後の IBM i の日時に揃える", async () => {
    localFile("ORDR01-受注 'A'.sqlrpgle", "C1\r\nC2\r\n", "2026-09-27T12:00:00");
    const harness = await open({ exists: true, members: [] });
    await harness.send({ type: "direction", direction: "upload" });
    assert.equal(harness.lastState().direction, "upload");
    harness.transport.listing = { exists: true, members: [member("ORDR01", "2026-09-27T13:00:00")] };
    await harness.send({ type: "transfer", names: ["ORDR01"] });
    assert.deepEqual(harness.transport.uploads.map(upload => [upload.target.member, upload.target.extension, upload.text, upload.attributes]), [
      ["ORDR01", "sqlrpgle", "C1\nC2\n", { sourceType: "SQLRPGLE", textDescription: "受注 'A'" }]
    ]);
    assert.deepEqual(harness.modified, [[`${FOLDER}/ORDR01-受注 'A'.sqlrpgle`, at("2026-09-27T13:00:00")]]);
  });

  test("差分は左に転送先、右に転送元を開く", async () => {
    localFile("A.rpgle", "LOCAL\n", "2026-09-27T08:00:00");
    const harness = await open({ exists: true, members: [member("A", "2026-09-27T10:00:00")] }, { A: "REMOTE\n" });
    const diffs: unknown[][] = [];
    stub.commands.registered.set("vscode.diff", (...args: unknown[]) => { diffs.push(args); });
    await harness.send({ type: "diff", name: "A" });
    assert.equal(diffs.length, 1);
    const [left, right, title] = diffs[0] as [vscode.Uri, vscode.Uri, string];
    assert.equal(left.fsPath, `${FOLDER}/A.rpgle`);
    assert.equal(right.scheme, "ibmi-member");
    assert.equal(stub.workspace.__contentProviders.get("ibmi-member").provideTextDocumentContent(right), "REMOTE\n");
    assert.match(title, /^A: ローカル ↔ IBM i/u);
  });

  test("不正なメッセージは無視する", async () => {
    const harness = await open({ exists: true, members: [member("A", "2026-09-27T10:00:00")] });
    const before = harness.posted.length;
    await harness.send({ type: "transfer", names: "A" });
    await harness.send({ type: "direction", direction: "sideways" });
    assert.equal(harness.posted.length, before);
    assert.deepEqual(harness.transport.downloads, []);
  });
});
