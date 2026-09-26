/**
 * RPGUnit のテストをコンパイルして実行する手順の共通部品。`vscode` を import しない
 * （VS Code の Test Explorer と `tools/run-rpgunit.mjs` の両方が使う）。
 * 接続は `SuiteConnection` として受け取る——VS Code 側は Code for IBM i、道具は ts5250 の hostserver。
 */
import { posix } from "node:path";
import { deriveSourceType, type MemberTarget } from "../sync/memberTarget";
import {
  buildCreateStreamTestCommand, buildCreateTestCommand, buildRunTestCommand, quoteClString,
  type ReclaimResources, type RunOrder
} from "./rpgunitCommands";
import { parseJUnitXml, type TestSuiteResult } from "./resultParser";
import type { StreamTestTarget } from "./streamTarget";
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

/** 作るテスト・プログラム（ライブラリーと名前）。メンバー方式ではメンバー名がそのままプログラム名になる。 */
export interface TestProgram {
  readonly library: string;
  readonly program: string;
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

/** IFS 方式の失敗は段階を持つ。変換（`CPY`）の失敗なら、呼び出し側が「展開されているか」の案内を足せる。 */
export type StreamCompileOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly stage: "convert" | "compile"; readonly detail: string };

/**
 * IFS 方式。展開は済んでいる前提（`deployRoot` の下に `target.relativePath` がある）。
 *
 * 主ソースを `CPY … TOCCSID(*JOBCCSID) DTAFMT(*TEXT)` で一時ディレクトリへ写してから `RUCRTRPG SRCSTMF` に渡す。
 * 7.3（ジョブ CCSID 5035）では UTF-8（タグ 1208）の主ソースを直接渡すと `CPE3490` で開けない。EBCDIC に写せば
 * 日本語の注記・リテラルとも通る。コピー句は 1208 のままで読める
 * （`.aidev/works/20260926-rpgunit-ifs-deploy/research.md` F2・F5・F21・F22、decisions.md D6）。
 * 写しは元と別の場所にあるので、`INCDIR` に元のテストのディレクトリと展開先の最上位をこの順で渡す
 * （コンパイラーは主ソースのディレクトリも探すが、写しのディレクトリになるため。research F6）。
 */
export async function compileStreamSuite(
  conn: SuiteConnection,
  input: {
    program: TestProgram;
    target: StreamTestTarget;
    deployRoot: string;
    binding: BindingSpec;
    noTgtCcsid?: boolean;
    keepCopy?: boolean;
  }
): Promise<StreamCompileOutcome> {
  const { program, target, deployRoot, binding, noTgtCcsid, keepCopy } = input;
  // 末尾の `/` を落とす（`/` そのものは残す）
  const root = posix.normalize(deployRoot).replace(/(.)\/+$/, "$1");
  const source = posix.join(root, target.relativePath);
  const copy = `${conn.tempDirectory}/${program.program}.${target.extension}`;
  try {
    const converted = await conn.runCommand(
      `CPY OBJ(${quoteClString(source)}) TOOBJ(${quoteClString(copy)}) TOCCSID(*JOBCCSID) DTAFMT(*TEXT) REPLACE(*YES)`
    );
    if (converted.code !== 0) {
      return {
        ok: false,
        stage: "convert",
        detail: `IFS のソースを変換できません（${source}）。\n${converted.stderr || converted.stdout || "(詳細なし)"}`
      };
    }
    const sourceDirectory = posix.dirname(source);
    const result = await conn.runCommand(
      buildCreateStreamTestCommand({
        library: program.library,
        program: program.program,
        sourceStreamFile: copy,
        includeDirectories: sourceDirectory === root ? [root] : [sourceDirectory, root],
        bindServicePrograms: binding.servicePrograms,
        bindingDirectories: binding.bindingDirectories,
        noTgtCcsid
      }),
      { libraryList: testLibraryList(program.library, conn.libraryList) }
    );
    return result.code === 0
      ? { ok: true }
      : { ok: false, stage: "compile", detail: result.stderr || result.stdout || "(詳細なし)" };
  } finally {
    if (!keepCopy) {
      // 片付けの失敗でコンパイルの結果を上書きしない（結果 XML の削除と同じ扱い）
      await conn.runCommand(`QSYS/RMVLNK OBJLNK(${quoteClString(copy)})`).catch(() => undefined);
    }
  }
}

export type RunOutcome =
  | { readonly ok: true; readonly suite: TestSuiteResult; readonly xml: string }
  | { readonly ok: false; readonly detail: string };

/** 結果 XML を消す → `RUCALLTST` → 取得 → 消す（`keepXml` なら残す）→ 解析。合否は XML で決める。 */
export async function runSuite(
  conn: SuiteConnection,
  input: { program: TestProgram; order?: RunOrder; reclaimResources?: ReclaimResources; keepXml?: boolean }
): Promise<RunOutcome> {
  const { program, order, reclaimResources, keepXml } = input;
  const xmlPath = `${conn.tempDirectory}/${program.program}.xml`;
  const remove = () => conn.runCommand(`QSYS/RMVLNK OBJLNK('${xmlPath}')`).catch(() => undefined);
  // パスは毎回同じ。前回の XML が残っていると、今回 RUCALLTST が結果を出さなかったときに古い結果を読む。
  await remove();
  // テストが失敗すると RUCALLTST 自体も CPF9897 で失敗を返す（実機で確認）。合否は XML で決めるので code は見ない。
  await conn.runCommand(
    buildRunTestCommand({ library: program.library, program: program.program, xmlStmf: xmlPath, order, reclaimResources }),
    { libraryList: testLibraryList(program.library, conn.libraryList) }
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
