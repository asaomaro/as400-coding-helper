/**
 * RPGUnit の 2 つの実機 E2E（VS Code の `dev/rpgunit-e2e.mjs` と道具の `tools/run-rpgunit-e2e.mjs`）が使う
 * テストソースとテスト対象・片付け。**同じソースで両方を確かめる**ために 1 か所に置く
 * （片方だけ直すと、2 つの経路が同じ入力で同じ結果を返すことを確かめられなくなる）。
 *
 * 資格情報は ts5250 の暗号化プロファイルからメモリ上で復号する（出力しない・保存しない）。
 * 起動は ts5250 の `--env-file` で行う（`.env` の中身は読まない）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const TS5250 = process.env.TS5250_DIR ?? "/workspaces/ts5250";

/** ts5250 の hostserver と資格情報（メモリのみ）。 */
export async function connectHostServer() {
  const hs = await import(join(TS5250, "packages/hostserver/dist/index.js"));
  const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
  const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
  const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
  if (!sys) throw new Error(`profiles.local.json に ${process.env.AS400_SYSTEM} がありません`);
  const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
  const sql = async statement => {
    const db = await hs.DbConnection.connect({ ...creds, resolvePort: true, timeoutMs: 30000 });
    try { const r = await hs.query(db, statement); return r.rows ?? r; } finally { db.close(); }
  };
  return { hs, creds, sql };
}

// --- 固定長の行を桁で組み立てる（手で空白を数えない） ---
const H = keywords => `     H${keywords}`;
const P = (name, beginEnd, keywords = "") => `     P${name.padEnd(15)}  ${beginEnd}${" ".repeat(19)}${keywords}`.trimEnd();
const D = (name, type, length = "", dataType = "", decimals = "", keywords = "") =>
  `     D${name.padEnd(15)}  ${type.padEnd(2)}${" ".repeat(7)}${length.padStart(7)}${dataType.padEnd(1)}` +
  `${decimals.padStart(2)} ${keywords}`.trimEnd();
const C = (opcode, extended) => `     C${" ".repeat(19)}${opcode.padEnd(10)}${extended}`;
const COPY_TESTCASE = "      /COPY RPGUNIT/QINCLUDE,TESTCASE";

/** テスト対象のサービスプログラム（`e2eAdd(a:b)` = a + b を公開）。 */
export const CALC_SOURCE = [
  H("NOMAIN"),
  D("e2eAdd", "PR", "10", "I", "0"), D("a", "", "10", "I", "0", "CONST"), D("b", "", "10", "I", "0", "CONST"),
  P("e2eAdd", "B", "EXPORT"),
  D("e2eAdd", "PI", "10", "I", "0"), D("a", "", "10", "I", "0", "CONST"), D("b", "", "10", "I", "0", "CONST"),
  C("RETURN", "a + b"),
  P("e2eAdd", "E"),
  ""
].join("\n");

/** サービスプログラムの手続きを呼ぶテスト。バインドが無いと未解決の参照でテストを作れない。 */
export const BIND_TEST_SOURCE = [
  H("NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)"),
  COPY_TESTCASE,
  D("e2eAdd", "PR", "10", "I", "0"), D("a", "", "10", "I", "0", "CONST"), D("b", "", "10", "I", "0", "CONST"),
  P("TESTADD", "B", "EXPORT"),
  D("TESTADD", "PI"),
  C("CALLP", "assertEqual(5:e2eAdd(2:3))"),
  P("TESTADD", "E"),
  ""
].join("\n");

/**
 * `TESTPASS`（合格）と `TESTFAIL`（`Expected '2', but was '3'.` で失敗）。
 * `broken` なら `TESTFAIL` が存在しない手続きを呼び、コンパイルが失敗する。
 * `oracleHeader` を渡すと先頭にオラクルの印を置く（道具の `--require-oracle` の検品を通すため）。
 */
export function basicSource(broken, oracleHeader = []) {
  return [
    "     H NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)",
    ...oracleHeader,
    COPY_TESTCASE,
    "     PTESTPASS         B                   EXPORT",
    "     DTESTPASS         PI",
    "     C                   CALLP     assertEqual(2:2)",
    "     PTESTPASS         E",
    "     PTESTFAIL         B                   EXPORT",
    "     DTESTFAIL         PI",
    broken
      ? "     C                   CALLP     undefinedProc(2:3)"
      : "     C                   CALLP     assertEqual(2:3)",
    "     PTESTFAIL         E",
    ""
  ].join("\n");
}

/**
 * `basicSource` と**同じ 2 手続き**（件数と失敗メッセージを比べられるように）で、日本語の注記と、`TESTPASS` の比較を
 * 日本語の文字リテラルにしたもの。IFS 方式で UTF-8 のまま送ったソースが、変換してコンパイルされることを確かめる
 * （`.aidev/works/20260926-rpgunit-ifs-deploy/design.md` AC4）。
 */
export function japaneseSource() {
  return [
    "     H NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)",
    "      * 日本語の注記：IFS 方式のテスト",
    COPY_TESTCASE,
    "     PTESTPASS         B                   EXPORT",
    "     DTESTPASS         PI",
    "     C                   CALLP     assert('日本語' = '日本語':'jp')",
    "     PTESTPASS         E",
    "     PTESTFAIL         B                   EXPORT",
    "     DTESTFAIL         PI",
    "     C                   CALLP     assertEqual(2:3)",
    "     PTESTFAIL         E",
    ""
  ].join("\n");
}

/** IFS のコピー句（日本語の注記と、日本語の文字リテラルの定数）。 */
export const COPY_HEADER = [
  "      * コピー句の日本語の注記",
  "     D JP_WORD         C                   CONST('日本語')",
  ""
].join("\n");

/** コピー句を IFS の相対パスで `/COPY` し、その日本語の定数を比べるテスト（手続き名は `procedure`）。 */
export function copyTestSource(copyPath, procedure = "TESTCOPY") {
  return [
    "     H NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)",
    COPY_TESTCASE,
    `      /COPY ${copyPath}`,
    `     P${procedure.padEnd(15)}  B                   EXPORT`,
    `     D${procedure.padEnd(15)}  PI`,
    "     C                   CALLP     assert(JP_WORD = '日本語':'copy')",
    `     P${procedure.padEnd(15)}  E`,
    ""
  ].join("\n");
}

export const CALC = "E2ECALC";
export const BNDDIR = "E2EBND";

/** `testing.json` の中身。`key` は `bndSrvPgm`（`CALC` を指す）か `bndDir`（`BNDDIR` を指す）。 */
export const bindConfig = key =>
  JSON.stringify({ rpgunit: { rucrtrpg: { [key]: [key === "bndSrvPgm" ? CALC : BNDDIR] } } }, null, 2);

/** テスト対象のサービスプログラムとバインディング・ディレクトリを実機に作る。 */
export async function createBindTargets({ hs, creds }, lib) {
  const ifsPath = `${process.env.AS400_IFS_DIR}/${CALC}.rpgle`;
  const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
  try { await ifs.writeFile(ifsPath, new TextEncoder().encode(CALC_SOURCE), { create: true, truncate: true }); }
  finally { ifs.close(); }
  const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true, timeoutMs: 60000 });
  try {
    const steps = [
      `CPYFRMSTMF FROMSTMF('${ifsPath}') TOMBR('/QSYS.LIB/${lib}.LIB/QUNITSRC.FILE/${CALC}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`,
      `CHGPFM FILE(${lib}/QUNITSRC) MBR(${CALC}) SRCTYPE(RPGLE)`,
      `CRTRPGMOD MODULE(${lib}/${CALC}) SRCFILE(${lib}/QUNITSRC) SRCMBR(${CALC}) REPLACE(*YES)`,
      `CRTSRVPGM SRVPGM(${lib}/${CALC}) MODULE(${lib}/${CALC}) EXPORT(*ALL) REPLACE(*YES)`,
      `CRTBNDDIR BNDDIR(${lib}/${BNDDIR})`,
      `ADDBNDDIRE BNDDIR(${lib}/${BNDDIR}) OBJ((${lib}/${CALC} *SRVPGM))`
    ];
    for (const step of steps) {
      const r = await cmd.run(step);
      if (!r.success) {
        throw new Error(`テスト対象を作れません: ${step}\n${(r.messages ?? []).map(m => `${m.id} ${m.text}`).join("\n")}`);
      }
    }
    await cmd.run(`RMVLNK OBJLNK('${ifsPath}')`).catch(() => undefined);
  } finally { cmd.close(); }
}

/** `*SRVPGM` があるか（「古い *SRVPGM が残っている」前提の確認）。 */
export async function srvpgmExists({ sql }, lib, name) {
  return (await sql(`SELECT OBJNAME FROM TABLE(QSYS2.OBJECT_STATISTICS('${lib}','*SRVPGM')) WHERE OBJNAME='${name}'`)).length > 0;
}

/**
 * `names` のメンバーとオブジェクト、`BNDDIR`、`ifsDirs`（IFS のディレクトリ。中身ごと）を消し、**残っている数**を返す（0 が合格）。
 * スプールは消さない。
 */
export async function cleanUp({ hs, creds, sql }, lib, names, ifsDirs = []) {
  const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true, timeoutMs: 20000 });
  try {
    for (const name of names) {
      for (const type of ["*SRVPGM", "*MODULE", "*PGM"]) {
        await cmd.run(`DLTOBJ OBJ(${lib}/${name}) OBJTYPE(${type})`).catch(() => undefined);
      }
      await cmd.run(`RMVM FILE(${lib}/QUNITSRC) MBR(${name})`).catch(() => undefined);
    }
    await cmd.run(`DLTOBJ OBJ(${lib}/${BNDDIR}) OBJTYPE(*BNDDIR)`).catch(() => undefined);
    for (const dir of ifsDirs) await cmd.run(`RMDIR DIR('${dir}') SUBTREE(*ALL)`).catch(() => undefined);
  } finally { cmd.close(); }
  const quoted = [...names, BNDDIR].map(n => `'${n}'`).join(",");
  const objects = await sql(`SELECT OBJNAME FROM TABLE(QSYS2.OBJECT_STATISTICS('${lib}','*ALL')) WHERE OBJNAME IN (${quoted})`);
  const members = await sql(`SELECT SYSTEM_TABLE_MEMBER FROM QSYS2.SYSPARTITIONSTAT
    WHERE SYSTEM_TABLE_SCHEMA='${lib}' AND SYSTEM_TABLE_NAME='QUNITSRC' AND SYSTEM_TABLE_MEMBER IN (${quoted})`);
  let ifsLeft = 0;
  for (const dir of ifsDirs) {
    const rows = await sql(`SELECT COUNT(*) AS N FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(START_PATH_NAME => '${dir}', SUBTREE_DIRECTORIES => 'NO'))`)
      .catch(() => [{ N: 0 }]);   // 無ければ関数が失敗する＝残っていない
    ifsLeft += Number(rows[0]?.N ?? 0);
  }
  return objects.length + members.length + ifsLeft;
}
