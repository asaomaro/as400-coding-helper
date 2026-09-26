import * as vscode from "vscode";
import type { MemberTarget } from "../sync/memberTarget";
import type { CommandResultLike, SuiteConnection } from "./suiteRunner";

/**
 * Code for IBM i 拡張機能（`halcyontechltd.code-for-ibmi`）へのソフト検出adapter。
 * `package.json` の `extensionDependencies` には追加しない（`.aidev/works/20260922-rpgunit-vscode-testing/decisions.md` D1）。
 * `20260910-ibmi-source-member-sync` の decisions.md D1（後に撤回）と同じ検出パターン
 * （未導入・未接続・API不一致をそれぞれ別の理由として明示する）。
 */

const EXTENSION_ID = "halcyontechltd.code-for-ibmi";

/** SBMJOB＋ポーリング方式の結果（`.aidev/works/20260922-rpgunit-vscode-testing/decisions.md` D2のフォールバック）。 */
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
  /**
   * 接続設定（`codefori/vscode-ibmi` 3.0.13 の `ConnectionConfig`。`src/api/configuration/config/types.ts`）。
   * `defaultDeploymentMethod` は 3.0.13 では必ずある（`''` を含む）が、構造的な最小 interface なので無い版にも耐える形にする。
   */
  getConfig(): {
    readonly libraryList: readonly string[];
    readonly currentLibrary?: string;
    readonly defaultDeploymentMethod?: string;
  };
  /** 実機で使えるコマンド（`md5sum` など）。`src/api/IBMi.ts` の `remoteFeatures`。 */
  readonly remoteFeatures?: { readonly [name: string]: string | undefined };
  readonly content: {
    uploadMemberContent(library: string, sourceFile: string, member: string, content: string): Promise<boolean>;
    downloadStreamfileRaw(remotePath: string): Promise<Uint8Array>;
    writeStreamfileRaw(remotePath: string, content: string): Promise<unknown>;
    checkObject(object: { library: string; name: string; type: string }): Promise<boolean>;
  };
}

/**
 * Code for IBM i のデプロイ（`exports.deployTools`。3.0.13 の `src/filesystems/local/deployTools.ts`）のうち使う部分。
 * `getRemoteDeployDirectory` は利用者が設定したデプロイ先（未設定なら undefined。77-81 行）。
 * `launchDeploy` は方法を渡せば選択の UI を出さずにデプロイし、失敗なら undefined（91-153 行）。
 */
export interface RawDeployTools {
  getRemoteDeployDirectory(folder: vscode.WorkspaceFolder): string | undefined;
  launchDeploy(workspaceIndex?: number, method?: string): Promise<{ readonly remoteDirectory: string } | undefined>;
}

export type DeployOutcome =
  | { readonly ok: true; readonly remoteDirectory: string }
  | { readonly ok: false; readonly reason: "notConfigured" | "failed" | "unavailable" };

/**
 * デプロイの方法。利用者の既定の方法が**この環境で使えるなら** Code for IBM i に任せる（undefined を渡す）。
 * 使えない既定（`compare` なのに `md5sum` が無い、`staged`/`unstaged` なのに Git 拡張が無い、候補に無い値）を渡すと、
 * Code for IBM i は警告を出して方法の選択 UI を開き、テストの実行が利用者の選択待ちで止まる
 * （3.0.13 `deployTools.ts` 98-127 行の候補の組み立てと同じ条件で判定する）。
 * 既定が無い・使えないときは MD5 で比べる `compare`（`md5sum` があるとき）、無ければ `all`。
 * `changed` は既定に選ばれていない限り使わない——拡張を起動してから変わったファイルしか送らず、初回に要るファイルが
 * 届かないことがある（`.aidev/works/20260926-rpgunit-ifs-deploy/decisions.md` D5）。
 */
export function chooseDeployMethod(
  config: { readonly defaultDeploymentMethod?: string },
  remoteFeatures: { readonly [name: string]: string | undefined } | undefined,
  gitAvailable: boolean
): string | undefined {
  const md5 = Boolean(remoteFeatures?.md5sum);
  const usable = new Set(["changed", "all", ...(md5 ? ["compare"] : []), ...(gitAvailable ? ["staged", "unstaged"] : [])]);
  if (config.defaultDeploymentMethod && usable.has(config.defaultDeploymentMethod)) {
    return undefined;
  }
  return md5 ? "compare" : "all";
}

/** Code for IBM i の接続。テストの手順が使う部分（`SuiteConnection`）に、この拡張だけが使う操作を足したもの。 */
export interface IbmiTestingConnection extends SuiteConnection {
  /** `RUCRTRPG` が同期実行のタイムアウトに収まらない場合のフォールバック（`.aidev/works/20260922-rpgunit-vscode-testing/decisions.md` D2, D4）。 */
  runCommandSubmitted(
    command: string,
    opts: { jobNamePrefix: string; timeoutSeconds?: number }
  ): Promise<SubmittedCommandResult>;
  writeStreamfile(remotePath: string, content: string): Promise<void>;
  checkObjectExists(object: { library: string; name: string; type: string }): Promise<boolean>;
  runSQL(statements: string): Promise<readonly Record<string, unknown>[]>;
  /** 接続設定の現行ライブラリー。IFS 方式のテスト・プログラムを作るライブラリー（decisions D7）。 */
  readonly currentLibrary: string | undefined;
  /** ワークスペース・フォルダーを IFS へデプロイする（IFS 方式の実行前。フォルダーごとに 1 回）。 */
  deploy(folder: vscode.WorkspaceFolder): Promise<DeployOutcome>;
}

export type ConnectFailureReason = "notInstalled" | "notConnected" | "incompatibleApi";

export type ConnectResult =
  | { readonly ok: true; readonly connection: IbmiTestingConnection }
  | { readonly ok: false; readonly reason: ConnectFailureReason };

/** 実物のCode for IBM i接続を、このモジュールが使う狭いinterfaceへ包む。 */
export function wrapConnection(connection: RawIbmiConnection, deployTools?: RawDeployTools): IbmiTestingConnection {
  const config = connection.getConfig();
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
    async deploy(folder) {
      if (!deployTools) {
        return { ok: false, reason: "unavailable" };
      }
      try {
        // 未設定のまま launchDeploy を呼ぶと、Code for IBM i がエラーダイアログを出す（3.0.13 deployTools.ts 146-150 行）。
        if (!deployTools.getRemoteDeployDirectory(folder)) {
          return { ok: false, reason: "notConfigured" };
        }
        const result = await deployTools.launchDeploy(folder.index, chooseDeployMethod(config, connection.remoteFeatures, vscode.extensions.getExtension("vscode.git") !== undefined));
        return result ? { ok: true, remoteDirectory: result.remoteDirectory } : { ok: false, reason: "failed" };
      } catch {
        return { ok: false, reason: "failed" };
      }
    },
    tempDirectory: connection.getTempDirectory(),
    libraryList: [...(config.libraryList ?? [])],
    currentLibrary: config.currentLibrary?.trim().toUpperCase() || undefined
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

function looksLikeDeployTools(value: unknown): value is RawDeployTools {
  const candidate = value as Partial<RawDeployTools> | undefined;
  return typeof candidate?.getRemoteDeployDirectory === "function" && typeof candidate.launchDeploy === "function";
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
    // デプロイが無い版でもメンバー方式は動かす（IFS 方式だけ unavailable になる）
    const deployTools: unknown = (api as { deployTools?: unknown } | undefined)?.deployTools;
    return { ok: true, connection: wrapConnection(connection, looksLikeDeployTools(deployTools) ? deployTools : undefined) };
  } catch {
    return { ok: false, reason: "incompatibleApi" };
  }
}
