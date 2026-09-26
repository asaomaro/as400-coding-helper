import * as vscode from "vscode";
import type { MemberTarget } from "../sync/memberTarget";

/**
 * Code for IBM i 拡張機能（`halcyontechltd.code-for-ibmi`）へのソフト検出adapter。
 * `package.json` の `extensionDependencies` には追加しない（decisions.md D1）。
 * `20260910-ibmi-source-member-sync` の decisions.md D1（後に撤回）と同じ検出パターン
 * （未導入・未接続・API不一致をそれぞれ別の理由として明示する）。
 */

const EXTENSION_ID = "halcyontechltd.code-for-ibmi";

export interface CommandResultLike {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** SBMJOB＋ポーリング方式の結果（decisions.md D2のフォールバック）。 */
export interface SubmittedCommandResult {
  /** ジョブが timeoutSeconds 以内に消滅したか。 */
  readonly completed: boolean;
}

/**
 * このモジュールがCode for IBM iの接続から実際に使う操作の最小集合。
 * 実物の `IBMi` クラス（`@halcyontech/vscode-ibmi-types`）は private フィールドを持つため
 * テストでフェイクを作れない。ここは構造的な最小interfaceにして、テストでは素の
 * オブジェクトリテラルを渡せるようにする。
 */
export interface RawIbmiConnection {
  /**
   * ILE コマンドは Code for IBM i の SQL ジョブで `CHGLIBL` のあとに実行される。
   * `env` の `&LIBL` を渡すとその `CHGLIBL` のライブラリー・リストを差し替えられる
   * （`codefori/vscode-ibmi` の `src/api/CompileTools.ts` の `runCommand`）。
   * 失敗（エスケープ・メッセージ）なら `code` が 0 以外になり、ジョブログが `stderr` に入る。
   */
  runCommand(data: { command: string; env?: Record<string, string> }): Promise<CommandResultLike>;
  runSQL(statements: string): Promise<readonly Record<string, unknown>[]>;
  getTempDirectory(): string;
  getConfig(): { readonly libraryList: readonly string[] };
  readonly content: {
    uploadMemberContent(library: string, sourceFile: string, member: string, content: string): Promise<boolean>;
    downloadStreamfileRaw(remotePath: string): Promise<Uint8Array>;
    writeStreamfileRaw(remotePath: string, content: string): Promise<unknown>;
    checkObject(object: { library: string; name: string; type: string }): Promise<boolean>;
  };
}

export interface IbmiTestingConnection {
  uploadMemberContent(target: MemberTarget, content: string): Promise<boolean>;
  /** `libraryList` を渡すと、そのコマンドの間だけライブラリー・リストを差し替える。 */
  runCommand(command: string, opts?: { libraryList?: readonly string[] }): Promise<CommandResultLike>;
  /** `RUCRTRPG` が同期実行のタイムアウトに収まらない場合のフォールバック（decisions.md D2, D4）。 */
  runCommandSubmitted(
    command: string,
    opts: { jobNamePrefix: string; timeoutSeconds?: number }
  ): Promise<SubmittedCommandResult>;
  /** RPGUnitのXML結果はCCSID 819（Latin-1）で出る前提でデコードする
   *  （`docs/workflow/rpgunit-install.md:213-231`）。 */
  downloadStreamfile(remotePath: string): Promise<string>;
  writeStreamfile(remotePath: string, content: string): Promise<void>;
  checkObjectExists(object: { library: string; name: string; type: string }): Promise<boolean>;
  runSQL(statements: string): Promise<readonly Record<string, unknown>[]>;
  readonly tempDirectory: string;
  /** 利用者が Code for IBM i に設定しているライブラリー・リスト。 */
  readonly libraryList: readonly string[];
}

export type ConnectFailureReason = "notInstalled" | "notConnected" | "incompatibleApi";

export type ConnectResult =
  | { readonly ok: true; readonly connection: IbmiTestingConnection }
  | { readonly ok: false; readonly reason: ConnectFailureReason };

/** 実物のCode for IBM i接続を、このモジュールが使う狭いinterfaceへ包む。 */
export function wrapConnection(connection: RawIbmiConnection): IbmiTestingConnection {
  return {
    async uploadMemberContent(target, content) {
      return connection.content.uploadMemberContent(target.library, target.sourceFile, target.member, content);
    },
    async runCommand(command, opts) {
      const env = opts?.libraryList ? { "&LIBL": opts.libraryList.join(" ") } : undefined;
      const result = await connection.runCommand({ command, ...(env ? { env } : {}) });
      return { code: result.code, stdout: result.stdout, stderr: result.stderr };
    },
    async runCommandSubmitted(command, opts) {
      // tools/run-rpgunit.mjs の waitJob と同型（ジョブ消滅で完了を判定する）。
      const jobName = `${opts.jobNamePrefix}${Date.now().toString(36).slice(-5).toUpperCase()}`.slice(0, 10);
      const submit = await connection.runCommand({
        command: `SBMJOB CMD(${command}) JOB(${jobName}) INQMSGRPY(*DFT)`
      });
      if (submit.code !== 0) {
        return { completed: false };
      }
      const timeoutSeconds = opts.timeoutSeconds ?? 180;
      const deadline = Date.now() + timeoutSeconds * 1000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const rows = await connection.runSQL(
          `SELECT JOB_NAME FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO=>'NONE')) ` +
          `WHERE UPPER(JOB_NAME) LIKE '%${jobName}%'`
        );
        if (rows.length === 0) {
          return { completed: true };
        }
      }
      return { completed: false };
    },
    async downloadStreamfile(remotePath) {
      const bytes = await connection.content.downloadStreamfileRaw(remotePath);
      return Buffer.from(bytes).toString("latin1");
    },
    async writeStreamfile(remotePath, content) {
      await connection.content.writeStreamfileRaw(remotePath, content);
    },
    async checkObjectExists(object) {
      return connection.content.checkObject(object);
    },
    async runSQL(statements) {
      return connection.runSQL(statements);
    },
    tempDirectory: connection.getTempDirectory(),
    libraryList: [...(connection.getConfig().libraryList ?? [])]
  };
}

function looksLikeRawConnection(value: unknown): value is RawIbmiConnection {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RawIbmiConnection>;
  return (
    typeof candidate.runCommand === "function" &&
    typeof candidate.runSQL === "function" &&
    typeof candidate.getTempDirectory === "function" &&
    typeof candidate.getConfig === "function" &&
    typeof candidate.content === "object" &&
    candidate.content !== null &&
    typeof (candidate.content as Record<string, unknown>).uploadMemberContent === "function"
  );
}

/**
 * `halcyontechltd.code-for-ibmi` を検出し、必要なら`activate()`したうえで
 * `instance.getConnection()` を確認する。未導入・未接続・API不一致は別の理由として返す
 * （接続なしと同じ成功扱いにしない）。
 */
export async function connectViaCodeForIbmi(): Promise<ConnectResult> {
  const ext = vscode.extensions.getExtension<unknown>(EXTENSION_ID);
  if (!ext) {
    return { ok: false, reason: "notInstalled" };
  }
  try {
    const api = ext.isActive ? ext.exports : await ext.activate();
    const connection: unknown = (api as { instance?: { getConnection?: () => unknown } } | undefined)
      ?.instance?.getConnection?.();
    if (!connection) {
      return { ok: false, reason: "notConnected" };
    }
    if (!looksLikeRawConnection(connection)) {
      return { ok: false, reason: "incompatibleApi" };
    }
    return { ok: true, connection: wrapConnection(connection) };
  } catch {
    return { ok: false, reason: "incompatibleApi" };
  }
}
