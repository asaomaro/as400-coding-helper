import { utimes } from "node:fs/promises";
import * as vscode from "vscode";
import { buildDdsEditorHtml, createNonce } from "../dds/webviewHtml";
import {
  buildSyncRows,
  countLines,
  downloadFileName,
  isTransferable,
  overwriteConfirmations,
  readLocalMembers,
  type LocalFile,
  type RemoteListing,
  type SyncDirection,
  type SyncRow
} from "./bulkSync";
import { createIbmiSourceTransport, type IbmiSourceTransport } from "./ibmiSourceTransport";
import { deriveSourceType, isIbmiObjectName, resolveMemberTarget, type MemberTarget } from "./memberTarget";
import { visibleToWire, wireToVisible } from "./visibleColorMarkers";
import { parseSyncMessage, type HostMessage, type SyncView } from "./webview/protocol";
import { openTransport, toUserMessage, type TransportFactory } from "../extension/commands/memberSync";

export const OPEN_BULK_SYNC_COMMAND = "rpgClSupport.ibmiSourceSync.openBulk";
const MEMBER_SCHEME = "ibmi-member";
const WEBVIEW_DIR = ["out", "sync-webview"];

/** テストで差し替える部分。 */
export interface BulkSyncDependencies {
  readonly transportFactory: TransportFactory;
  /** ローカルの更新日時を揃える。file 以外のスキームでは何もしない。 */
  readonly setModified: (uri: vscode.Uri, time: number) => Promise<void>;
}

const defaultDependencies: BulkSyncDependencies = {
  transportFactory: createIbmiSourceTransport,
  setModified: async (uri, time) => {
    if (uri.scheme !== "file") return;
    await utimes(uri.fsPath, new Date(), new Date(time));
  }
};

/**
 * ソース・ファイル単位の送受信を開くコマンド。
 *
 * エクスプローラーの `src/<LIB>/<SRCFILE>` フォルダの右クリック（引数にフォルダの Uri）と、
 * コマンドパレット（ライブラリーとソース・ファイルを入力。ローカルにまだフォルダが無いときの初回用）の両方から開く。
 */
export function registerBulkSyncCommand(
  context: vscode.ExtensionContext,
  dependencies: BulkSyncDependencies = defaultDependencies
): void {
  const contents = new Map<string, string>();
  const sessions = new Map<string, BulkSyncSession>();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(MEMBER_SCHEME, {
      provideTextDocumentContent: uri => contents.get(uri.toString()) ?? ""
    }),
    vscode.commands.registerCommand(OPEN_BULK_SYNC_COMMAND, async (uri?: vscode.Uri) => {
      const location = uri instanceof Object && "fsPath" in uri ? locateFromFolder(uri) : await locateFromInput();
      if (location === undefined) return;
      if ("error" in location) {
        await vscode.window.showErrorMessage(location.error);
        return;
      }
      const key = `${location.library}/${location.sourceFile}|${location.folder.toString()}`;
      const existing = sessions.get(key);
      if (existing !== undefined) {
        existing.reveal();
        return;
      }
      const session = new BulkSyncSession(context, dependencies, location, contents, () => sessions.delete(key));
      sessions.set(key, session);
    })
  );
}

interface SyncLocation {
  readonly library: string;
  readonly sourceFile: string;
  readonly folder: vscode.Uri;
  /** ワークスペースからの相対パス。 */
  readonly folderLabel: string;
}

function locateFromFolder(uri: vscode.Uri): SyncLocation | { error: string } {
  const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/gu, "/");
  const segments = relative.split("/");
  const library = segments[1]?.toUpperCase() ?? "";
  const sourceFile = segments[2]?.toUpperCase() ?? "";
  if (segments.length !== 3 || segments[0] !== "src" || !isIbmiObjectName(library) || !isIbmiObjectName(sourceFile)) {
    return { error: "ソース・ファイル単位の送受信は src/<ライブラリー>/<ソース・ファイル> のフォルダで開いてください。" };
  }
  return { library, sourceFile, folder: uri, folderLabel: relative };
}

async function locateFromInput(): Promise<SyncLocation | { error: string } | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const workspaceFolder = folders.length > 1 ? await vscode.window.showWorkspaceFolderPick() : folders[0];
  if (workspaceFolder === undefined) {
    return folders.length === 0 ? { error: "ソース・ファイル単位の送受信はワークスペースを開いて実行してください。" } : undefined;
  }
  const validateInput = (value: string): string | undefined =>
    isIbmiObjectName(value.trim().toUpperCase()) ? undefined : "英字または $ # @ で始まる 10 文字以内の名前を入れてください。";
  const library = (await vscode.window.showInputBox({ prompt: "IBM i のライブラリー", ignoreFocusOut: true, validateInput }))
    ?.trim().toUpperCase();
  if (!library) return undefined;
  const sourceFile = (await vscode.window.showInputBox({
    prompt: `${library} のソース・ファイル`,
    value: "QRPGSRC",
    ignoreFocusOut: true,
    validateInput
  }))?.trim().toUpperCase();
  if (!sourceFile) return undefined;
  if (!isIbmiObjectName(library) || !isIbmiObjectName(sourceFile)) {
    return { error: "ライブラリーとソース・ファイルの名前が IBM i のオブジェクト名として正しくありません。" };
  }
  // 既にあるフォルダは大文字・小文字を問わず使う（`src/mylib/qrpgsrc` でも同じ対応づけで読めるため）。
  const libraryFolder = await findChild(vscode.Uri.joinPath(workspaceFolder.uri, "src"), library);
  const libraryName = libraryFolder ?? library;
  const fileFolder = await findChild(vscode.Uri.joinPath(workspaceFolder.uri, "src", libraryName), sourceFile);
  const fileName = fileFolder ?? sourceFile;
  return {
    library,
    sourceFile,
    folder: vscode.Uri.joinPath(workspaceFolder.uri, "src", libraryName, fileName),
    folderLabel: `src/${libraryName}/${fileName}`
  };
}

async function findChild(parent: vscode.Uri, name: string): Promise<string | undefined> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(parent);
    return entries.find(([entry, type]) => type === vscode.FileType.Directory && entry.toUpperCase() === name)?.[0];
  } catch {
    return undefined;
  }
}

/** 1 つのソース・ファイル ⇔ フォルダの画面。 */
class BulkSyncSession {
  private readonly panel: vscode.WebviewPanel;
  private direction: SyncDirection = "download";
  private remote: RemoteListing | undefined;
  private localFiles: LocalFile[] = [];
  private rows: SyncRow[] = [];
  private busy = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly dependencies: BulkSyncDependencies,
    private readonly location: SyncLocation,
    private readonly contents: Map<string, string>,
    onDispose: () => void
  ) {
    const root = vscode.Uri.joinPath(context.extensionUri, ...WEBVIEW_DIR);
    this.panel = vscode.window.createWebviewPanel(
      "rpgClSupport.ibmiBulkSync",
      `IBM i ${location.library}/${location.sourceFile}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [root], retainContextWhenHidden: true }
    );
    this.panel.webview.html = buildDdsEditorHtml({
      cspSource: this.panel.webview.cspSource,
      nonce: createNonce(),
      scriptUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(root, "sync.js")).toString(),
      styleUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(root, "sync.css")).toString(),
      title: `IBM i ${location.library}/${location.sourceFile}`
    });
    // 約束を返すのはテストが待てるようにするため（VS Code は戻り値を見ない）。
    const receiving = this.panel.webview.onDidReceiveMessage(value => this.receive(value));
    this.panel.onDidDispose(() => {
      receiving.dispose();
      onDispose();
    });
  }

  reveal(): void {
    this.panel.reveal();
  }

  private post(message: HostMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private async receive(value: unknown): Promise<void> {
    const message = parseSyncMessage(value);
    if (message === undefined) return;
    if (this.busy && message.type !== "ready") return;
    switch (message.type) {
      case "ready":
        this.postState();
        if (this.remote === undefined) await this.run(() => this.load());
        return;
      case "refresh":
        await this.run(() => this.load());
        return;
      case "direction":
        this.direction = message.direction;
        this.rebuild();
        return;
      case "diff":
        await this.run(() => this.diff(message.name));
        return;
      case "transfer":
        await this.run(() => this.transfer(message.names));
        return;
    }
  }

  /** 処理中は画面の操作を止め、失敗は画面に出す。 */
  private async run(action: () => Promise<void>): Promise<void> {
    this.busy = true;
    try {
      await action();
    } catch (error) {
      this.post({ type: "notice", kind: "error", text: toUserMessage(error) });
    } finally {
      this.busy = false;
      this.post({ type: "busy" });
    }
  }

  private progress(text: string): void {
    this.post({ type: "busy", text });
  }

  private postState(): void {
    const view: SyncView = {
      sourceFile: `${this.location.library}/${this.location.sourceFile}`,
      folder: this.location.folderLabel,
      direction: this.direction,
      rows: this.rows,
      loaded: this.remote !== undefined
    };
    this.post({ type: "state", ...view });
  }

  private rebuild(): void {
    this.rows = this.remote === undefined
      ? []
      : buildSyncRows(this.direction, this.remote.members, readLocalMembers(this.localFiles));
    this.postState();
  }

  private async load(): Promise<void> {
    this.progress("IBM i からメンバーの一覧を取得しています…");
    const transport = await openTransport(this.context, this.dependencies.transportFactory);
    try {
      await this.acceptListing(await transport.listMembers(this.location.library, this.location.sourceFile));
    } finally {
      transport.dispose();
    }
  }

  private async acceptListing(listing: RemoteListing): Promise<void> {
    this.localFiles = await this.readLocalFiles();
    if (!listing.exists) {
      this.remote = undefined;
      this.rows = [];
      this.postState();
      this.post({
        type: "notice",
        kind: "error",
        text: `IBM i にソース・ファイル ${this.location.library}/${this.location.sourceFile} がありません（ソース物理ファイルではない場合も含む）。`
      });
      return;
    }
    this.remote = listing;
    this.rebuild();
  }

  private async readLocalFiles(): Promise<LocalFile[]> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(this.location.folder);
    } catch {
      return [];
    }
    const files: LocalFile[] = [];
    for (const [fileName, type] of entries) {
      if (type !== vscode.FileType.File) continue;
      const uri = vscode.Uri.joinPath(this.location.folder, fileName);
      const [stat, bytes] = await Promise.all([vscode.workspace.fs.stat(uri), vscode.workspace.fs.readFile(uri)]);
      files.push({ fileName, modified: stat.mtime, lines: countLines(Buffer.from(bytes).toString("utf8")) });
    }
    return files;
  }

  private target(row: SyncRow): MemberTarget {
    const local = this.direction === "download" ? row.target : row.source;
    const resolved = local?.fileName === undefined ? undefined : resolveMemberTarget(`src/L/F/${local.fileName}`);
    return {
      library: this.location.library,
      sourceFile: this.location.sourceFile,
      member: row.name,
      extension: resolved?.ok ? resolved.target.extension : (row.source?.sourceType || "txt").toLowerCase(),
      ...(resolved?.ok && resolved.target.textDescription !== undefined
        ? { textDescription: resolved.target.textDescription }
        : {})
    };
  }

  private localUri(row: SyncRow): vscode.Uri | undefined {
    const local = this.direction === "download" ? row.target : row.source;
    return local?.fileName === undefined ? undefined : vscode.Uri.joinPath(this.location.folder, local.fileName);
  }

  /** 左 = 転送先、右 = 転送元（右が転送した後の姿）。 */
  private async diff(name: string): Promise<void> {
    const row = this.rows.find(entry => entry.name === name);
    const localUri = row === undefined ? undefined : this.localUri(row);
    if (row === undefined || localUri === undefined || row.source === undefined || row.target === undefined) return;
    this.progress(`${name} を IBM i から読んでいます…`);
    const transport = await openTransport(this.context, this.dependencies.transportFactory);
    let text: string;
    try {
      text = wireToVisible(await transport.download(this.target(row)));
    } finally {
      transport.dispose();
    }
    const target = this.target(row);
    const remoteUri = vscode.Uri.from({
      scheme: MEMBER_SCHEME,
      path: `/${target.library}/${target.sourceFile}/${target.member}.${target.extension}`,
      query: String(Date.now())
    });
    this.contents.set(remoteUri.toString(), text);
    const [left, right, title] = this.direction === "download"
      ? [localUri, remoteUri, `${name}: ローカル ↔ IBM i（転送すると右になる）`]
      : [remoteUri, localUri, `${name}: IBM i ↔ ローカル（転送すると右になる）`];
    await vscode.commands.executeCommand("vscode.diff", left, right, title);
  }

  private async transfer(names: readonly string[]): Promise<void> {
    const chosen = this.rows.filter(row => names.includes(row.name) && isTransferable(row));
    const failures: string[] = [];
    // 未保存の変更がある文書は、どちら向きでも触らない（ダウンロードは上書きで消え、アップロードは保存前の内容を送る）。
    const dirty = new Set(
      vscode.workspace.textDocuments.filter(document => document.isDirty).map(document => document.uri.toString())
    );
    let rows = chosen.filter(row => {
      const uri = this.localUri(row);
      if (uri !== undefined && dirty.has(uri.toString())) {
        failures.push(`${row.name}: 未保存の変更があります。保存してから転送してください。`);
        return false;
      }
      return true;
    });

    const newer = overwriteConfirmations(rows, rows.map(row => row.name));
    if (newer.length > 0) {
      const overwrite = "上書きする";
      const skip = "新しいものを除いて転送";
      const answer = await vscode.window.showWarningMessage(
        `転送先の方が新しいメンバーが ${newer.length} 件あります。上書きしますか？`,
        { modal: true, detail: newer.join("、") },
        overwrite,
        skip
      );
      if (answer === undefined) return;
      if (answer === skip) rows = rows.filter(row => !newer.includes(row.name));
    }
    if (rows.length === 0) {
      if (failures.length > 0) this.post({ type: "notice", kind: "error", text: failures.join("\n") });
      return;
    }

    this.progress("IBM i に接続しています…");
    const transport = await openTransport(this.context, this.dependencies.transportFactory);
    const done: SyncRow[] = [];
    try {
      for (const [index, row] of rows.entries()) {
        this.progress(`転送しています（${index + 1}/${rows.length}）${row.name}`);
        try {
          if (this.direction === "download") await this.downloadOne(transport, row);
          else await this.uploadOne(transport, row);
          done.push(row);
        } catch (error) {
          failures.push(`${row.name}: ${toUserMessage(error)}`);
        }
      }
      this.progress("IBM i からメンバーの一覧を取得しています…");
      const listing = await transport.listMembers(this.location.library, this.location.sourceFile);
      await this.alignModified(done, listing);
      await this.acceptListing(listing);
    } finally {
      transport.dispose();
    }
    this.post({ type: "transferred" });
    const summary = `${done.length} 件を${this.direction === "download" ? "ダウンロード" : "アップロード"}しました。`;
    this.post(failures.length === 0
      ? { type: "notice", kind: "info", text: summary }
      : { type: "notice", kind: "error", text: [summary, ...failures].join("\n") });
  }

  private async downloadOne(transport: IbmiSourceTransport, row: SyncRow): Promise<void> {
    const existing = this.localUri(row);
    const uri = existing ?? vscode.Uri.joinPath(this.location.folder, downloadFileName({
      name: row.name,
      sourceType: row.source?.sourceType ?? "",
      text: row.source?.text ?? ""
    }));
    const text = wireToVisible(await transport.download(this.target(row))).replace(/\r\n|\r/gu, "\n");
    let crlf = vscode.workspace.getConfiguration("files").get<string>("eol") === "\r\n";
    if (existing !== undefined) {
      crlf = Buffer.from(await vscode.workspace.fs.readFile(existing)).toString("utf8").includes("\r\n");
    } else {
      await vscode.workspace.fs.createDirectory(this.location.folder);
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(crlf ? text.replace(/\n/gu, "\r\n") : text, "utf8"));
  }

  private async uploadOne(transport: IbmiSourceTransport, row: SyncRow): Promise<void> {
    const uri = this.localUri(row);
    if (uri === undefined) return;
    const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    const wire = visibleToWire(text).replace(/\r\n|\r/gu, "\n");
    const target = this.target(row);
    await transport.upload(target, wire, {
      sourceType: deriveSourceType(target.extension),
      ...(target.textDescription !== undefined ? { textDescription: target.textDescription } : {})
    });
  }

  /**
   * 転送したメンバーのローカルの更新日時を IBM i の更新日時に揃える。
   * これが無いと、ダウンロードしただけでローカルが「新しい」になる（状態は日時の新旧だけで見るため）。
   */
  private async alignModified(done: readonly SyncRow[], listing: RemoteListing): Promise<void> {
    const files = await this.readLocalFiles();
    const local = readLocalMembers(files);
    for (const row of done) {
      const member = listing.members.find(entry => entry.name === row.name);
      const file = local.members.find(entry => entry.name === row.name);
      if (member === undefined || file === undefined) continue;
      try {
        await this.dependencies.setModified(vscode.Uri.joinPath(this.location.folder, file.fileName), member.changed);
      } catch {
        // 揃えられなくても転送は済んでいる。状態が「ローカルが新しい」と出るだけ。
      }
    }
  }
}
