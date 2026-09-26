/**
 * IFS 方式の RPGUnit テスト（`*.test.rpgle` をワークスペースのどこにでも置き、IFS に展開して `RUCRTRPG SRCSTMF` で作る）の
 * 共通部品。`vscode` を import しない（VS Code の Test Explorer と `tools/run-rpgunit.mjs` の両方が使う）。
 * 置き方と名前の規則は IBM i Testing（`IBM/vscode-ibmi-testing`）に揃える——同じテストが同じ名前になる
 * （`.aidev/works/20260926-rpgunit-ifs-deploy/decisions.md` D7）。
 */
import { isIbmiObjectName } from "../sync/memberTarget";

/** IBM i Testing と同じ接尾辞（`api/apiUtils.ts` の `getTestSuffixes`）。大文字小文字は問わない。 */
export const STREAM_TEST_SUFFIXES: readonly string[] = [".test.rpgle", ".test.sqlrpgle"];

function baseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function isStreamTestFile(fileName: string): boolean {
  const lower = baseName(fileName).toLowerCase();
  return STREAM_TEST_SUFFIXES.some(suffix => lower.endsWith(suffix) && lower.length > suffix.length);
}

/**
 * IBM i Testing の `getSystemNameFromPath`（Source Orbit 由来）と同じ規則でテスト・プログラム名を作る。
 * `calc.test.rpgle` → `TCALC`。`.test` を外し、`-` より前を取り、`T` を前置して 10 文字以内ならそれ。
 * 超えれば `_` の前を接頭辞にし、名前の先頭と大文字を拾って詰め、`T` を前置して 10 文字に切る。
 * 作った名前が IBM i のオブジェクト名として不正なら undefined（`.` を含むなど）。
 * IBM i Testing と違うのは 2 点だけ: 不正な名前を返さない（IBM i Testing は `TMY.CALC` のような名前をそのまま返す）、
 * 名前部分が空のファイル（`.test.rpgle`）をテストとして扱わない（IBM i Testing は `T` になる）。
 */
export function streamTestProgramName(fileName: string): string | undefined {
  if (!isStreamTestFile(fileName)) {
    return undefined;
  }
  const file = baseName(fileName);
  // IBM i Testing は path.parse(fsPath).name（最後の拡張子を除いたもの）を渡す。`calc.test` の `.test` を外す。
  const inputName = file.slice(0, file.lastIndexOf(".")).slice(0, -".test".length);
  const name = systemName(inputName);
  return isIbmiObjectName(name) ? name : undefined;
}

/** `getSystemNameFromPath` のテスト（`.TEST` 付き）の分岐をそのまま写したもの。 */
function systemName(inputName: string): string {
  const base = inputName.includes("-") ? inputName.split("-")[0] : inputName;
  if (`T${base}`.length <= 10) {
    return `T${base}`.toUpperCase();
  }
  let prefix = "";
  let name = base;
  if (base.includes("_")) {
    const parts = base.split("_");
    prefix = parts[0];
    name = parts[1];
  }
  let result = prefix;
  for (let i = 0; i < name.length && result.length < 10; i++) {
    const char = name[i];
    if (char === char.toUpperCase() || i === 0) {
      result += char;
    }
  }
  if (result.length === 1) {
    result = name.substring(0, 10);
  }
  return `T${result}`.substring(0, 10).toUpperCase();
}

export interface StreamTestTarget {
  /** 展開先の最上位（VS Code はワークスペース・フォルダー、道具は送信の最上位）からの相対パス。区切りは `/`。 */
  readonly relativePath: string;
  /** "rpgle" | "sqlrpgle"（小文字）。変換した写しの拡張子に使う（SQL かどうかを RUCRTRPG に伝える）。 */
  readonly extension: string;
  /** 規則で作ったプログラム名。作れなければ undefined（実行時に errored にする）。 */
  readonly program: string | undefined;
}

/** 相対パスが IFS 方式のテストなら target、でなければ undefined。 */
export function resolveStreamTestTarget(relativePath: string): StreamTestTarget | undefined {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.?\/+/, "");
  if (!isStreamTestFile(normalized)) {
    return undefined;
  }
  const extension = normalized.slice(normalized.lastIndexOf(".") + 1).toLowerCase();
  return { relativePath: normalized, extension, program: streamTestProgramName(normalized) };
}
