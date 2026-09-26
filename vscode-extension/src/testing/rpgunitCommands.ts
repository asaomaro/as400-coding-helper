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

/** `RUCRTRPG` の1行を組み立てる。`SRCMBR` は常に `program` と同じ値にする。 */
export function buildCreateTestCommand(opts: CreateTestCommandOptions): string {
  const { library, program, sourceFile, bindServicePrograms = [], bindingDirectories = [], noTgtCcsid = false } = opts;
  const bnd = bindServicePrograms.length ? ` BNDSRVPGM(${bindServicePrograms.join(" ")})` : "";
  const bndDir = bindingDirectories.length ? ` BNDDIR(${bindingDirectories.join(" ")})` : "";
  const tgt = noTgtCcsid ? "" : " TGTCCSID(0)";
  return `RPGUNIT/RUCRTRPG TSTPGM(${library}/${program}) SRCFILE(${library}/${sourceFile}) ` +
    `SRCMBR(${program})${bnd}${bndDir}${tgt}`;
}

/** `RUCALLTST` の1行を組み立てる。 */
export function buildRunTestCommand(opts: RunTestCommandOptions): string {
  const { library, program, xmlStmf, order, reclaimResources } = opts;
  const orderPart = order ? ` ORDER(*${order.toUpperCase()})` : "";
  const rclrscPart = reclaimResources ? ` RCLRSC(*${reclaimResources.toUpperCase()})` : "";
  return `RPGUNIT/RUCALLTST TSTPGM(${library}/${program}) OUTPUT(*NONE) ` +
    `XMLSTMF('${xmlStmf}')${orderPart}${rclrscPart}`;
}
