/**
 * RPGUnit（`RUCRTRPG`/`RUCALLTST`）のコマンド文字列を組み立てる。
 * `tools/run-rpgunit.mjs` のコマンド構築ロジックの移植（純粋ロジック。実行トランスポートは持たない）。
 */

export type RunOrder = "api" | "reverse";
export type ReclaimResources = "no" | "always" | "once";

export interface CreateTestCommandOptions {
  readonly library: string;
  /**
   * テストプログラム名。`SRCMBR` にもこの値をそのまま使う——
   * 別名を渡すと `getMemberType` がプログラム名でメンバーを探しに行き `CPF9815` になる
   * （`.claude/skills/rpgunit-test/SKILL.md:291-303` で実機確認済み）。
   */
  readonly program: string;
  readonly sourceFile: string;
  /**
   * `BNDSRVPGM`。修飾の無い名前はそのまま渡し、`RUCRTRPG` の既定（`*LIBL`）で解決させる
   * （IBM i Testing の `testing.json` と同じ解釈。`.aidev/works/20260926-rpgunit-bind-srvpgm/decisions.md` D4）。
   */
  readonly bindServicePrograms?: readonly string[];
  /** `BNDDIR`。扱いは `bindServicePrograms` と同じ。 */
  readonly bindingDirectories?: readonly string[];
  /** v4.0.3.r 以前（`TGTCCSID` パラメータ自体が無い版）でのみ true にする。 */
  readonly noTgtCcsid?: boolean;
}

export interface RunTestCommandOptions {
  readonly library: string;
  readonly program: string;
  readonly xmlStmf: string;
  readonly order?: RunOrder;
  readonly reclaimResources?: ReclaimResources;
}

/** CL の文字列リテラル（`'…'`）。中の `'` は 2 つ重ねる。 */
export function quoteClString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** バインド指定と `TGTCCSID` の後半（メンバー方式・IFS 方式で共通）。 */
function bindAndCcsid(opts: {
  bindServicePrograms?: readonly string[];
  bindingDirectories?: readonly string[];
  noTgtCcsid?: boolean;
}): string {
  const { bindServicePrograms = [], bindingDirectories = [], noTgtCcsid = false } = opts;
  const bnd = bindServicePrograms.length ? ` BNDSRVPGM(${bindServicePrograms.join(" ")})` : "";
  const bndDir = bindingDirectories.length ? ` BNDDIR(${bindingDirectories.join(" ")})` : "";
  const tgt = noTgtCcsid ? "" : " TGTCCSID(0)";
  return `${bnd}${bndDir}${tgt}`;
}

/** `RUCRTRPG` の1行を組み立てる。`SRCMBR` は常に `program` と同じ値にする。 */
export function buildCreateTestCommand(opts: CreateTestCommandOptions): string {
  const { library, program, sourceFile } = opts;
  return `RPGUNIT/RUCRTRPG TSTPGM(${library}/${program}) SRCFILE(${library}/${sourceFile}) ` +
    `SRCMBR(${program})${bindAndCcsid(opts)}`;
}

export interface CreateStreamTestCommandOptions {
  readonly library: string;
  readonly program: string;
  /** コンパイルする IFS のソース（IFS 方式では、主ソースを EBCDIC に変換した写し）。 */
  readonly sourceStreamFile: string;
  /** `/COPY` の相対パスを探すディレクトリ（順に探す）。空なら `INCDIR` を付けない。 */
  readonly includeDirectories: readonly string[];
  readonly bindServicePrograms?: readonly string[];
  readonly bindingDirectories?: readonly string[];
  readonly noTgtCcsid?: boolean;
}

/**
 * IFS 方式の `RUCRTRPG`（`SRCSTMF`）。7.3（SR-OSAKA）で `SRCSTMF` と複数の `INCDIR` を受け付けることを実機で確認済み
 * （`.aidev/works/20260926-rpgunit-ifs-deploy/research.md` F1・F22）。
 */
export function buildCreateStreamTestCommand(opts: CreateStreamTestCommandOptions): string {
  const { library, program, sourceStreamFile, includeDirectories } = opts;
  const incDir = includeDirectories.length ? ` INCDIR(${includeDirectories.map(quoteClString).join(" ")})` : "";
  return `RPGUNIT/RUCRTRPG TSTPGM(${library}/${program}) SRCSTMF(${quoteClString(sourceStreamFile)})` +
    `${incDir}${bindAndCcsid(opts)}`;
}

/** `RUCALLTST` の1行を組み立てる。 */
export function buildRunTestCommand(opts: RunTestCommandOptions): string {
  const { library, program, xmlStmf, order, reclaimResources } = opts;
  const orderPart = order ? ` ORDER(*${order.toUpperCase()})` : "";
  const rclrscPart = reclaimResources ? ` RCLRSC(*${reclaimResources.toUpperCase()})` : "";
  return `RPGUNIT/RUCALLTST TSTPGM(${library}/${program}) OUTPUT(*NONE) ` +
    `XMLSTMF('${xmlStmf}')${orderPart}${rclrscPart}`;
}
