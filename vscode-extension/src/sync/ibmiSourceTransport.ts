import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";
import { buildMemberListSql, parseMemberListing, type RemoteListing } from "./bulkSync";
import { isIbmiObjectName, type MemberTarget } from "./memberTarget";

export type IbmiAuthMethod = "password" | "privateKey";

/** 同期専用の非機密設定。資格情報は別途 SecretStorage から受け取る。 */
export interface IbmiSourceSyncSettings {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly authMethod: IbmiAuthMethod;
  readonly privateKeyPath?: string;
  readonly ifsTempDirectory: string;
  readonly hostKeySha256: string;
}

export type IbmiSourceSyncErrorKind =
  | "configuration"
  | "hostKey"
  | "authentication"
  | "transfer"
  | "copy"
  | "attributes"
  | "list"
  | "cleanup";

/** 秘密値や raw command を含まない、利用者向けに分類済みの同期エラー。 */
export class IbmiSourceSyncError extends Error {
  constructor(
    readonly kind: IbmiSourceSyncErrorKind,
    message: string
  ) {
    super(message);
    this.name = "IbmiSourceSyncError";
  }
}

/** アップロード時に IBM i メンバーへ反映する属性。ファイル名から抽出済み・検証済みの値を渡す。 */
export interface UploadAttributes {
  /** `deriveSourceType` の戻り値。 */
  readonly sourceType: string;
  /** 未加工の利用者文字列。CL 文字列リテラルへ埋め込む前に transport 側でエスケープする。 */
  readonly textDescription?: string;
}

export interface IbmiSourceTransport {
  /** UTF-8 wire text。EOL と可視 marker は command 層が扱う。 */
  download(target: MemberTarget): Promise<string>;
  /**
   * LF 正規化済みの UTF-8 wire text を source member へ反映し、続けて SRCTYPE/TEXT 属性を反映する。
   * 内容コピーが失敗すれば `kind: "copy"`、内容コピー成功後の属性反映だけが失敗すれば
   * `kind: "attributes"` として区別する（内容は既に反映済みであることが呼出元へ伝わるようにする）。
   */
  upload(target: MemberTarget, utf8WireText: string, attributes: UploadAttributes): Promise<void>;
  /**
   * ソース・ファイルのメンバー一覧。`RUNSQL` 1 回で UTF-8 の JSON を IFS に書かせ、SFTP で読む
   * （`bulkSync.ts` の `buildMemberListSql`）。名前は検査済みのものだけを渡す。
   */
  listMembers(library: string, sourceFile: string): Promise<RemoteListing>;
  dispose(): void;
}

type SshClientFactory = () => Client;

const SAFE_IFS_PATH = /^\/(?:[A-Za-z0-9_.$#@-]+\/)*[A-Za-z0-9_.$#@-]*$/u;
const SHA256_HEX = /^[A-Fa-f0-9]{64}$/u;
const SHA256_BASE64 = /^SHA256:[A-Za-z0-9+/]{43}=?$/u;
const SOURCE_TYPE = /^[A-Z$#@][A-Z0-9_$#@]{0,9}$/u;
const TEXT_DESCRIPTION_MAX_LENGTH = 50;

/**
 * SSH 接続を作る。第3引数は unit test で接続ライフサイクルを差し替えるためだけのもの。
 */
export async function createIbmiSourceTransport(
  settings: IbmiSourceSyncSettings,
  authenticationSecret: string | undefined,
  clientFactory: SshClientFactory = () => new Client()
): Promise<IbmiSourceTransport> {
  validateSettings(settings, authenticationSecret);

  let privateKey: Buffer | undefined;
  if (settings.authMethod === "privateKey") {
    try {
      privateKey = await readFile(settings.privateKeyPath!);
    } catch {
      throw new IbmiSourceSyncError(
        "configuration",
        "秘密鍵ファイルを読み取れません。IBM i 同期の privateKeyPath を確認してください。"
      );
    }
  }

  const client = clientFactory();
  await connect(client, settings, authenticationSecret, privateKey);
  return new SshIbmiSourceTransport(client, settings.ifsTempDirectory);
}

class SshIbmiSourceTransport implements IbmiSourceTransport {
  private disposed = false;

  constructor(
    private readonly client: Client,
    private readonly ifsTempDirectory: string
  ) {}

  async download(target: MemberTarget): Promise<string> {
    this.ensureOpen();
    const temporaryPath = this.makeTemporaryPath();
    const result = await this.withCleanup(
      async () => {
        await executeCopy(this.client, buildCopyToStreamFileCommand(target, temporaryPath));
        const bytes = await this.withSftp(sftp => readSftpFile(sftp, temporaryPath));
        return bytes.toString("utf8");
      },
      temporaryPath
    );
    return result;
  }

  async upload(target: MemberTarget, utf8WireText: string, attributes: UploadAttributes): Promise<void> {
    this.ensureOpen();
    validateUploadAttributes(attributes);
    const temporaryPath = this.makeTemporaryPath();
    await this.withCleanup(
      async () => {
        await this.withSftp(sftp => writeSftpFile(sftp, temporaryPath, Buffer.from(utf8WireText, "utf8")));
        // CPYFRMSTMF は SFTP が stream file を閉じてからでなければ CPFA09E になり得る。
        // 宛先メンバーが無ければ CPYFRMSTMF が自動作成する（research.md F8。ADDPFM は呼ばない）。
        await executeCopy(this.client, buildCopyFromStreamFileCommand(target, temporaryPath));
        // 内容コピー成功後にだけ属性を反映する。CHGPFM は既存メンバーを前提にするため。
        await executeAttributeChange(this.client, buildChangeAttributesCommand(target, attributes));
      },
      temporaryPath
    );
  }

  async listMembers(library: string, sourceFile: string): Promise<RemoteListing> {
    this.ensureOpen();
    if (!isIbmiObjectName(library) || !isIbmiObjectName(sourceFile)) {
      throw new IbmiSourceSyncError("configuration", "ライブラリーとソース・ファイルの名前が IBM i のオブジェクト名として正しくありません。");
    }
    const temporaryPath = this.makeTemporaryPath();
    const text = await this.withCleanup(
      async () => {
        await executeClCommand(
          this.client,
          buildListMembersCommand(library, sourceFile, temporaryPath),
          "list",
          "IBM i のメンバー一覧を取得するコマンドが失敗しました。",
          "IBM i のメンバー一覧を取得するコマンドを完了できませんでした。"
        );
        return (await this.withSftp(sftp => readSftpFile(sftp, temporaryPath))).toString("utf8");
      },
      temporaryPath
    );
    const listing = parseMemberListing(text);
    if (listing === undefined) {
      throw new IbmiSourceSyncError("list", "IBM i のメンバー一覧を読み取れませんでした。");
    }
    return listing;
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.client.end();
    }
  }

  private ensureOpen(): void {
    if (this.disposed) {
      throw new IbmiSourceSyncError("transfer", "IBM i 同期接続はすでに閉じられています。");
    }
  }

  private makeTemporaryPath(): string {
    return `${this.ifsTempDirectory.replace(/\/$/u, "")}/ibmi-dogubako-${randomUUID()}.utf8`;
  }

  private async withSftp<T>(action: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
    const sftp = await openSftp(this.client);
    try {
      return await action(sftp);
    } finally {
      await closeSftp(sftp);
    }
  }

  private async withCleanup<T>(action: () => Promise<T>, temporaryPath: string): Promise<T> {
    let result: T | undefined;
    let primaryError: unknown;
    try {
      result = await action();
    } catch (error) {
      primaryError = error;
    }

    try {
      await this.withSftp(sftp => removeSftpFile(sftp, temporaryPath));
    } catch (cleanupError) {
      if (primaryError === undefined) {
        throw toSyncError("cleanup", cleanupError);
      }
    }

    if (primaryError !== undefined) {
      throw toSyncError("transfer", primaryError);
    }
    return result as T;
  }
}

function validateSettings(
  settings: IbmiSourceSyncSettings,
  authenticationSecret: string | undefined
): void {
  if (!settings.host.trim() || !settings.user.trim()) {
    throw new IbmiSourceSyncError("configuration", "IBM i 同期の host と user を設定してください。");
  }
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) {
    throw new IbmiSourceSyncError("configuration", "IBM i 同期の port は 1 から 65535 にしてください。");
  }
  if (!SAFE_IFS_PATH.test(settings.ifsTempDirectory) || settings.ifsTempDirectory === "/") {
    throw new IbmiSourceSyncError(
      "configuration",
      "IBM i 同期の ifsTempDirectory には安全な絶対 IFS ディレクトリーを設定してください。"
    );
  }
  if (!SHA256_HEX.test(settings.hostKeySha256) && !SHA256_BASE64.test(settings.hostKeySha256)) {
    throw new IbmiSourceSyncError(
      "configuration",
      "IBM i 同期の hostKeySha256 には SHA-256 fingerprint を設定してください。"
    );
  }
  if (settings.authMethod === "password" && !authenticationSecret) {
    throw new IbmiSourceSyncError(
      "configuration",
      "IBM i 同期のパスワードを「認証情報を保存」で登録してください。"
    );
  }
  if (settings.authMethod === "privateKey" && !settings.privateKeyPath?.trim()) {
    throw new IbmiSourceSyncError(
      "configuration",
      "秘密鍵認証には IBM i 同期の privateKeyPath を設定してください。"
    );
  }
}

async function connect(
  client: Client,
  settings: IbmiSourceSyncSettings,
  authenticationSecret: string | undefined,
  privateKey: Buffer | undefined
): Promise<void> {
  let rejectedHostKey = false;
  const config: ConnectConfig = {
    host: settings.host,
    port: settings.port,
    username: settings.user,
    hostVerifier: (key: Buffer) => {
      const matches = matchesHostKey(key, settings.hostKeySha256);
      rejectedHostKey = !matches;
      return matches;
    },
    readyTimeout: 15000,
    ...(settings.authMethod === "password"
      ? { password: authenticationSecret }
      : { privateKey, passphrase: authenticationSecret })
  };

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (kind: IbmiSourceSyncErrorKind, message: string): void => {
      if (!settled) {
        settled = true;
        reject(new IbmiSourceSyncError(kind, message));
      }
    };
    client.once("ready", () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });
    client.once("error", () =>
      fail(
        rejectedHostKey ? "hostKey" : "authentication",
        rejectedHostKey
          ? "IBM i の SSH ホスト鍵が設定した fingerprint と一致しません。"
          : "IBM i への SSH 接続または認証に失敗しました。"
      )
    );
    client.once("close", () => fail("transfer", "IBM i への SSH 接続が確立前に閉じられました。"));
    try {
      client.connect(config);
    } catch {
      fail("transfer", "IBM i への SSH 接続を開始できませんでした。");
    }
  });
}

function matchesHostKey(key: Buffer, expected: string): boolean {
  const actual = SHA256_HEX.test(expected)
    ? createHash("sha256").update(key).digest("hex")
    : `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=$/u, "")}`;
  // Hex は文字の大小が値に影響しないが、Base64 は大小文字を別の値として扱う。
  return SHA256_HEX.test(expected)
    ? actual.toLowerCase() === expected.toLowerCase()
    : actual === expected;
}

function buildMemberPath(target: MemberTarget): string {
  return `/QSYS.LIB/${target.library}.LIB/${target.sourceFile}.FILE/${target.member}.MBR`;
}

function buildCopyToStreamFileCommand(target: MemberTarget, temporaryPath: string): string {
  return `system "CPYTOSTMF FROMMBR('${buildMemberPath(target)}') TOSTMF('${temporaryPath}') STMFOPT(*REPLACE) STMFCCSID(1208) DBFCCSID(*FILE)"`;
}

/**
 * メンバー一覧を UTF-8 の JSON で IFS に書かせる。`QSYS2.IFS_WRITE_UTF8` は IBM i 7.3 で動く（実機で確認）。
 * SQL の `'` は RUNSQL の文字列の中なので 2 つに、全体は remote shell の二重引用符の中なので `$` などを逃がす
 * （`isIbmiObjectName` は `$` を許す）。
 */
export function buildListMembersCommand(library: string, sourceFile: string, temporaryPath: string): string {
  const sql = `CALL QSYS2.IFS_WRITE_UTF8(PATH_NAME => '${temporaryPath}', LINE => (${buildMemberListSql(library, sourceFile)}), OVERWRITE => 'REPLACE', END_OF_LINE => 'NONE')`;
  return `system "${escapeForRemoteShellDoubleQuoted(`RUNSQL SQL('${escapeClStringLiteral(sql)}') COMMIT(*NONE)`)}"`;
}

function buildCopyFromStreamFileCommand(target: MemberTarget, temporaryPath: string): string {
  return `system "CPYFRMSTMF FROMSTMF('${temporaryPath}') TOMBR('${buildMemberPath(target)}') MBROPT(*REPLACE) STMFCCSID(1208) DBFCCSID(*FILE)"`;
}

function validateUploadAttributes(attributes: UploadAttributes): void {
  if (!SOURCE_TYPE.test(attributes.sourceType)) {
    throw new IbmiSourceSyncError("configuration", "IBM i 同期のソース・タイプが不正です。");
  }
  if (attributes.textDescription !== undefined && attributes.textDescription.length > TEXT_DESCRIPTION_MAX_LENGTH) {
    throw new IbmiSourceSyncError("configuration", "IBM i 同期のテキスト記述が上限（50文字）を超えています。");
  }
}

/** CL 文字列リテラルのアポストロフィを `''`（2個）へエスケープする。未加工の利用者文字列を埋め込む前に必ず通す。 */
function escapeClStringLiteral(value: string): string {
  return value.replace(/'/gu, "''");
}

/**
 * `system "..."` の外側二重引用符コンテキスト向けにエスケープする。
 *
 * `client.exec()` で送るコマンド文字列は、SSH サーバー側でログイン shell に
 * `shell -c '<command>'` の形で実行される（sshd の一般的な exec リクエスト処理）。
 * そのため `system "..."` の二重引用符は remote shell が解釈し、内側の `\` `"` `$` `` ` ``
 * は shell の特殊文字として展開・エスケープ解除の対象になる。CL 文字列リテラルの
 * エスケープ（`escapeClStringLiteral`）だけでは this 層を素通りしてしまうため、
 * それとは独立にこの層のエスケープが要る（research.md F12・review ラウンド3）。
 */
function escapeForRemoteShellDoubleQuoted(value: string): string {
  return value.replace(/[\\"$`]/gu, character => `\\${character}`);
}

function buildChangeAttributesCommand(target: MemberTarget, attributes: UploadAttributes): string {
  const textClause = attributes.textDescription === undefined
    ? ""
    : ` TEXT('${escapeForRemoteShellDoubleQuoted(escapeClStringLiteral(attributes.textDescription))}')`;
  return `system "CHGPFM FILE(${target.library}/${target.sourceFile}) MBR(${target.member}) SRCTYPE(${attributes.sourceType})${textClause}"`;
}

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error || !sftp) {
        reject(toSyncError("transfer", error));
        return;
      }
      resolve(sftp);
    });
  });
}

/** SFTP の終わりを待つ上限。サーバーが閉じ返さなくても先へ進む（ファイルは閉じ終えている）。 */
const SFTP_CLOSE_TIMEOUT_MS = 5000;

function closeSftp(sftp: SFTPWrapper): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, SFTP_CLOSE_TIMEOUT_MS);
    timer.unref();
    sftp.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    sftp.end();
  });
}

function readSftpFile(sftp: SFTPWrapper, path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(path, (error, bytes) => (error ? reject(error) : resolve(bytes)));
  });
}

function writeSftpFile(sftp: SFTPWrapper, path: string, bytes: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(path, bytes, error => (error ? reject(error) : resolve()));
  });
}

function removeSftpFile(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(path, error => (error ? reject(error) : resolve()));
  });
}

/** 1 つのコマンドを待つ上限。これを超えたら接続先が応答していないとみなす。 */
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * `system "..."` を実行し、終了コード 0 で解決する。
 *
 * **標準出力も必ず読む。** ssh2 は標準出力を読み終えるまで `close` を出さない
 * （`onCHANNEL_CLOSE` が `end` を待つ）。読まずにいると、コマンドが終わっても永久に待つ
 * （2026-09-27 実際に一覧の取得で止まった。`test/unit/ibmiSshLoopback.test.ts`）。
 * 失敗したときは IBM i のメッセージ（`CPF9810: ...` など）を理由に添える。
 */
function executeClCommand(
  client: Client,
  command: string,
  kind: IbmiSourceSyncErrorKind,
  failureMessage: string,
  incompleteMessage: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error || !stream) {
        reject(toSyncError(kind, error));
        return;
      }

      let output = "";
      const collect = (data: Buffer | string): void => {
        if (output.length < 4000) output += String(data);
      };
      stream.on("data", collect);
      stream.stderr.on("data", collect);
      const timer = setTimeout(() => {
        reject(new IbmiSourceSyncError(kind, `${incompleteMessage}（${COMMAND_TIMEOUT_MS / 60000} 分応答がありません）`));
        stream.close();
      }, COMMAND_TIMEOUT_MS);
      // 待っているだけのタイマーでプロセス（テストの mocha など）を引き留めない。
      timer.unref();
      stream.on("close", (code: number | undefined) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }
        const messages = describeIbmiMessages(output);
        reject(new IbmiSourceSyncError(kind, messages ? `${failureMessage}（${messages}）` : output.trim() ? failureMessage : incompleteMessage));
      });
    });
  });
}

/** 出力から IBM i のメッセージ（`CPF9810: ...` の形の行）を拾う。無ければ出力の先頭。 */
export function describeIbmiMessages(output: string): string {
  const lines = output.split(/\r?\n/u).map(line => line.trim()).filter(line => line.length > 0);
  const messages = lines.filter(line => /^[A-Z][A-Z0-9]{2}[0-9A-F]{4}\b/u.test(line));
  return (messages.length > 0 ? messages : lines).slice(0, 3).join(" / ").slice(0, 300);
}

function executeCopy(client: Client, command: string): Promise<void> {
  return executeClCommand(
    client,
    command,
    "copy",
    "IBM i のコピー・コマンドが失敗しました。",
    "IBM i のコピー・コマンドを完了できませんでした。"
  );
}

function executeAttributeChange(client: Client, command: string): Promise<void> {
  return executeClCommand(
    client,
    command,
    "attributes",
    "IBM i のメンバー属性（テキスト記述・ソース・タイプ）の反映コマンドが失敗しました。",
    "IBM i のメンバー属性の反映コマンドを完了できませんでした。"
  );
}

function toSyncError(kind: IbmiSourceSyncErrorKind, error: unknown): IbmiSourceSyncError {
  if (error instanceof IbmiSourceSyncError) {
    return error;
  }
  const messageByKind: Record<IbmiSourceSyncErrorKind, string> = {
    configuration: "IBM i 同期の設定を確認してください。",
    hostKey: "IBM i の SSH ホスト鍵を確認してください。",
    authentication: "IBM i の SSH 認証に失敗しました。",
    transfer: "IBM i とのファイル転送に失敗しました。",
    copy: "IBM i の source member コピーに失敗しました。",
    attributes: "IBM i のメンバー属性の反映に失敗しました。",
    list: "IBM i のメンバー一覧を取得できませんでした。",
    cleanup: "IBM i の一時ファイルを削除できませんでした。"
  };
  return new IbmiSourceSyncError(kind, messageByKind[kind]);
}
