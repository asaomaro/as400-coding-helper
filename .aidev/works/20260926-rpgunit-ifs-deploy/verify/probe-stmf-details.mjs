/**
 * design 前の確認（research の申し送り）。
 *
 *   D1: `CPY … TOCCSID(*JOBCCSID) DTAFMT(*TEXT)` が使えるか・付くタグは何か（変換先をジョブに合わせられるか）
 *   D2: `INCDIR` に 2 つのディレクトリを渡せるか（元のテストのディレクトリ＋デプロイ先の最上位）。
 *       2 つ目にだけあるコピー句（日本語の文字リテラル入り・タグ 1208 のまま）が解決され、リテラルが正しく比較されるか
 *   D3: SQLRPGLE のテストを SRCSTMF で作れるか（拡張子 `.sqlrpgle` の写しを渡す）
 *
 *   cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify <このファイル>
 */
import { connectHostServer } from "../../../../vscode-extension/dev/rpgunit-e2e-fixtures.mjs";

const LIB = process.env.AS400_LIB.toUpperCase();
const DIR = `${process.env.AS400_IFS_DIR}/rpgifsprb`;
const { hs, creds } = await connectHostServer();
const db = await hs.DbConnection.connect({ ...creds, resolvePort: true, timeoutMs: 300000 });
const lastLog = async () => Number((await hs.query(db, "SELECT COALESCE(MAX(ORDINAL_POSITION),0) AS N FROM TABLE(QSYS2.JOBLOG_INFO('*'))")).rows[0].N);
async function cl(command) {
  const since = await lastLog();
  try { await hs.executeStatement(db, "CALL QSYS2.QCMDEXC(?)", { parameters: [command] }); return { ok: true, log: [] }; }
  catch {
    const log = (await hs.query(db, `SELECT MESSAGE_ID, MESSAGE_TEXT FROM TABLE(QSYS2.JOBLOG_INFO('*')) WHERE ORDINAL_POSITION > ${since} ORDER BY ORDINAL_POSITION`)).rows
      .map(r => `${r.MESSAGE_ID ?? ""}: ${String(r.MESSAGE_TEXT ?? "").trim()}`).filter(l => /^(CPE|RNS|RNF|CPF|CPD|SQL)/.test(l) && !/^(CPF9897|SQL0443)/.test(l));
    return { ok: false, log };
  }
}
const tagOf = async path => (await hs.query(db, `SELECT CCSID FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(START_PATH_NAME => '${path}', SUBTREE_DIRECTORIES => 'NO'))`)).rows[0]?.CCSID;
async function write(path, text) {
  const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
  try { await ifs.writeFile(path, new TextEncoder().encode(text), { create: true, dataCcsid: 1208 }); } finally { ifs.close(); }
}
const created = [];
async function build(label, pgm, command) {
  created.push(pgm);
  const r = await cl(command);
  let run = "";
  if (r.ok) {
    await cl(`RPGUNIT/RUCALLTST TSTPGM(${LIB}/${pgm}) OUTPUT(*NONE) XMLSTMF('${DIR}/r.xml')`);
    const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
    try {
      const xml = Buffer.from(await ifs.readFile(`${DIR}/r.xml`)).toString("latin1");
      run = (/<testsuite\b([^>]*)>/.exec(xml)?.[1] ?? "").match(/(tests|failures|errors)="\d+"/g)?.join(" ") ?? "";
      const msg = /<failure message="([^"]*)"/.exec(xml)?.[1];
      if (msg) run += `  失敗: ${msg}`;
    } finally { ifs.close(); }
    await cl(`RMVLNK OBJLNK('${DIR}/r.xml')`);
  }
  console.log(`${r.ok ? "OK" : "NG"}  ${label}${run ? `  実行: ${run}` : ""}`);
  for (const l of r.log.slice(0, 5)) console.log(`      ${l}`);
}

const TEST = [
  "     H NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)",
  "      * 日本語の注記",
  "      /COPY RPGUNIT/QINCLUDE,TESTCASE",
  "      /COPY qcopy/jp_h.rpgleinc",
  "     PTESTLIT          B                   EXPORT",
  "     DTESTLIT          PI",
  "     C                   CALLP     assert(JP_WORD = '日本語':'literal')",
  "     PTESTLIT          E",
  ""
].join("\n");
const COPY = "      * コピー句の日本語の注記\n     D JP_WORD         C                   CONST('日本語')\n";
const SQLTEST = [
  "     H NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)",
  "      /COPY RPGUNIT/QINCLUDE,TESTCASE",
  "     PTESTSQL          B                   EXPORT",
  "     DTESTSQL          PI",
  "     D n               S             10I 0",
  "     C/EXEC SQL",
  "     C+ SET :n = 7",
  "     C/END-EXEC",
  "     C                   CALLP     iEqual(7:n)",
  "     PTESTSQL          E",
  ""
].join("\n");

try {
  await cl(`CHGLIBL LIBL(RPGUNIT ${LIB} QGPL QTEMP) CURLIB(*CRTDFT)`);
  for (const d of [DIR, `${DIR}/root`, `${DIR}/root/qcopy`, `${DIR}/root/test`, `${DIR}/tmp`]) await cl(`MKDIR DIR('${d}')`);
  await write(`${DIR}/root/qcopy/jp_h.rpgleinc`, COPY);
  await write(`${DIR}/root/test/jplit.test.rpgle`, TEST);
  await write(`${DIR}/root/test/sqlt.test.sqlrpgle`, SQLTEST);

  console.log("== D1: TOCCSID(*JOBCCSID)");
  const c = await cl(`CPY OBJ('${DIR}/root/test/jplit.test.rpgle') TOOBJ('${DIR}/tmp/TJPLIT.rpgle') TOCCSID(*JOBCCSID) DTAFMT(*TEXT) REPLACE(*YES)`);
  console.log(`${c.ok ? "OK" : "NG"}  CPY TOCCSID(*JOBCCSID) → タグ ${c.ok ? await tagOf(`${DIR}/tmp/TJPLIT.rpgle`) : "-"}`);
  for (const l of c.log) console.log(`      ${l}`);

  console.log("== D2: INCDIR に 2 つ（1 つ目は元のテストのディレクトリ、2 つ目に最上位）");
  if (c.ok) await build("INCDIR 2 つ・日本語リテラルのコピー句（1208 のまま）", "TJPLIT",
    `RPGUNIT/RUCRTRPG TSTPGM(${LIB}/TJPLIT) SRCSTMF('${DIR}/tmp/TJPLIT.rpgle') INCDIR('${DIR}/root/test' '${DIR}/root') TGTCCSID(0)`);

  console.log("== D3: SQLRPGLE を SRCSTMF で");
  await cl(`CPY OBJ('${DIR}/root/test/sqlt.test.sqlrpgle') TOOBJ('${DIR}/tmp/TSQLT.sqlrpgle') TOCCSID(*JOBCCSID) DTAFMT(*TEXT) REPLACE(*YES)`);
  await build("拡張子 .sqlrpgle の写し", "TSQLT",
    `RPGUNIT/RUCRTRPG TSTPGM(${LIB}/TSQLT) SRCSTMF('${DIR}/tmp/TSQLT.sqlrpgle') TGTCCSID(0)`);
} finally {
  for (const name of created) await cl(`DLTOBJ OBJ(${LIB}/${name}) OBJTYPE(*SRVPGM)`);
  const files = await hs.query(db, `SELECT CAST(PATH_NAME AS VARCHAR(1024)) AS P FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(START_PATH_NAME => '${DIR}', SUBTREE_DIRECTORIES => 'YES')) WHERE OBJECT_TYPE = '*STMF'`).catch(() => ({ rows: [] }));
  for (const f of files.rows) await cl(`RMVLNK OBJLNK('${String(f.P).trim()}')`);
  const dirs = await hs.query(db, `SELECT CAST(PATH_NAME AS VARCHAR(1024)) AS P FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(START_PATH_NAME => '${DIR}', SUBTREE_DIRECTORIES => 'YES')) WHERE OBJECT_TYPE = '*DIR' ORDER BY LENGTH(CAST(PATH_NAME AS VARCHAR(1024))) DESC`).catch(() => ({ rows: [] }));
  for (const d of dirs.rows) await cl(`RMDIR DIR('${String(d.P).trim()}')`);
  const left = await hs.query(db, `SELECT OBJNAME FROM TABLE(QSYS2.OBJECT_STATISTICS('${LIB}','*ALL')) WHERE OBJNAME IN ('TJPLIT','TSQLT')`);
  const leftIfs = await hs.query(db, `SELECT COUNT(*) AS N FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(START_PATH_NAME => '${process.env.AS400_IFS_DIR}', SUBTREE_DIRECTORIES => 'NO')) WHERE CAST(PATH_NAME AS VARCHAR(1024)) LIKE '%rpgifsprb%'`);
  console.log(`残存: オブジェクト ${left.rows.length} / IFS ${leftIfs.rows[0].N}`);
  db.close();
}
