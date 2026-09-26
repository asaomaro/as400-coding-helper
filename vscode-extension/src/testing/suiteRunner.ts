/**
 * RPGUnit のテストをコンパイルして実行する手順の共通部品。`vscode` を import しない
 * （VS Code の Test Explorer と `tools/run-rpgunit.mjs` の両方が使う）。
 * 接続は `SuiteConnection` として受け取る——VS Code 側は Code for IBM i、道具は ts5250 の hostserver。
 */
import { deriveSourceType, type MemberTarget } from "../sync/memberTarget";
import { buildCreateTestCommand, buildRunTestCommand, type ReclaimResources, type RunOrder } from "./rpgunitCommands";
import { parseJUnitXml, type TestSuiteResult } from "./resultParser";
import type { BindingSpec } from "./testingConfigCore";

export interface CommandResultLike {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SuiteConnection {
  uploadMemberContent(target: MemberTarget, content: string): Promise<boolean>;
  /**
   * `libraryList` を渡すと、そのコマンドの間だけライブラリー・リストを差し替える。
   * 失敗（エスケープ・メッセージ）なら `code` が 0 以外で、`stderr` にジョブログが入る。
   */
  runCommand(command: string, opts?: { libraryList?: readonly string[] }): Promise<CommandResultLike>;
  /** RPGUnit の結果 XML は CCSID 819（Latin-1）で書かれる前提で復号する。 */
  downloadStreamfile(remotePath: string): Promise<string>;
  readonly tempDirectory: string;
  /** 呼び出し側の既定のライブラリー・リスト（VS Code は利用者の設定、道具は QGPL・QTEMP）。 */
  readonly libraryList: readonly string[];
}

/**
 * コンパイル・実行に使うライブラリー・リスト。`RPGUNIT` が要るのは、`TESTCASE` が
 * 修飾なしの `/include qinclude,TEMPLATES` を持つため（`.claude/skills/rpgunit-test/SKILL.md`
 * 「踏みやすい罠」）。無いと `CPF4102` で落ちる（実機で観測）。
 */
export function testLibraryList(targetLibrary: string, baseLibraryList: readonly string[]): readonly string[] {
  return [...new Set(["RPGUNIT", targetLibrary, ...baseLibraryList].map(name => name.toUpperCase()))];
}

export type CompileOutcome = { readonly ok: true } | { readonly ok: false; readonly detail: string };

/** アップロード → SRCTYPE → `RUCRTRPG`。成否は `RUCRTRPG` の結果で決める（オブジェクトの有無は見ない）。 */
export async function compileSuite(
  conn: SuiteConnection,
  input: { target: MemberTarget; source: string; binding: BindingSpec; noTgtCcsid?: boolean }
): Promise<CompileOutcome> {
  const { target, source, binding, noTgtCcsid } = input;
  await conn.uploadMemberContent(target, source);
  // アップロード（CPYFRMSTMF 相当）だけでは SRCTYPE 属性が付かない。RUCRTRPG は getMemberType() で
  // メンバーの SRCTYPE を見て分岐するため、別途設定が必須（`.claude/skills/ibmi-remote/SKILL.md`）。
  await conn.runCommand(
    `CHGPFM FILE(${target.library}/${target.sourceFile}) MBR(${target.member}) ` +
    `SRCTYPE(${deriveSourceType(target.extension)})`
  );
  const result = await conn.runCommand(
    buildCreateTestCommand({
      library: target.library,
      program: target.member,
      sourceFile: target.sourceFile,
      bindServicePrograms: binding.servicePrograms,
      bindingDirectories: binding.bindingDirectories,
      noTgtCcsid
    }),
    { libraryList: testLibraryList(target.library, conn.libraryList) }
  );
  // オブジェクトの有無で見ると、前回の *SRVPGM が残っているときにコンパイル失敗を成功と取り違える。
  return result.code === 0 ? { ok: true } : { ok: false, detail: result.stderr || result.stdout || "(詳細なし)" };
}

export type RunOutcome =
  | { readonly ok: true; readonly suite: TestSuiteResult; readonly xml: string }
  | { readonly ok: false; readonly detail: string };

/** 結果 XML を消す → `RUCALLTST` → 取得 → 消す（`keepXml` なら残す）→ 解析。合否は XML で決める。 */
export async function runSuite(
  conn: SuiteConnection,
  input: { target: MemberTarget; order?: RunOrder; reclaimResources?: ReclaimResources; keepXml?: boolean }
): Promise<RunOutcome> {
  const { target, order, reclaimResources, keepXml } = input;
  const xmlPath = `${conn.tempDirectory}/${target.member}.xml`;
  const remove = () => conn.runCommand(`QSYS/RMVLNK OBJLNK('${xmlPath}')`).catch(() => undefined);
  // パスは毎回同じ。前回の XML が残っていると、今回 RUCALLTST が結果を出さなかったときに古い結果を読む。
  await remove();
  // テストが失敗すると RUCALLTST 自体も CPF9897 で失敗を返す（実機で確認）。合否は XML で決めるので code は見ない。
  await conn.runCommand(
    buildRunTestCommand({ library: target.library, program: target.member, xmlStmf: xmlPath, order, reclaimResources }),
    { libraryList: testLibraryList(target.library, conn.libraryList) }
  );
  let xml: string;
  try {
    xml = await conn.downloadStreamfile(xmlPath);
  } catch (error) {
    return { ok: false, detail: `結果を取得できませんでした: ${String((error as Error)?.message ?? error)}` };
  } finally {
    if (!keepXml) {
      await remove();
    }
  }
  return { ok: true, suite: parseJUnitXml(xml), xml };
}
