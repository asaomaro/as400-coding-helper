/**
 * IBM i 7.3（SR-OSAKA・RPGUnit v6.0.2.r）で、RPGUnit のテストを IFS のソースから作れるかを確かめる。
 *
 *   P1: RUCRTRPG SRCSTMF(...) で作り、RUCALLTST で走らせる（TESTPASS 合格・TESTFAIL 失敗になるか）。
 *       テスト本体は `/COPY RPGUNIT/QINCLUDE,TESTCASE`（メンバー形式）のまま。
 *   P2: IFS の別ディレクトリにあるコピー句を `/COPY <相対パス>` で読む。INCDIR を付けた場合と付けない場合（対照）。
 *   P3: ソースと同じディレクトリにあるコピー句を INCDIR 無しで読めるか。
 *
 * 片付け: 作ったプログラム・IFS のファイルとディレクトリを消す。スプールは消さない。
 *
 *   cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify <このファイル>
 */
import { basicSource, connectHostServer } from "../../../../vscode-extension/dev/rpgunit-e2e-fixtures.mjs";

const LIB = process.env.AS400_LIB.toUpperCase();
const DIR = `${process.env.AS400_IFS_DIR}/rpgifsprb`;
const { hs, creds } = await connectHostServer();

const db = await hs.DbConnection.connect({ ...creds, resolvePort: true, timeoutMs: 300000 });
const lastLog = async () => Number((await hs.query(db, "SELECT COALESCE(MAX(ORDINAL_POSITION),0) AS N FROM TABLE(QSYS2.JOBLOG_INFO('*'))")).rows[0].N);
async function cl(command) {
  const since = await lastLog();
  try {
    await hs.executeStatement(db, "CALL QSYS2.QCMDEXC(?)", { parameters: [command] });
    return { ok: true, log: [] };
  } catch (error) {
    const log = (await hs.query(db, `SELECT MESSAGE_ID, MESSAGE_TEXT FROM TABLE(QSYS2.JOBLOG_INFO('*')) WHERE ORDINAL_POSITION > ${since} ORDER BY ORDINAL_POSITION`)).rows
      .map(r => `${r.MESSAGE_ID ?? ""}: ${String(r.MESSAGE_TEXT ?? "").trim()}`);
    return { ok: false, log, error: String(error.message ?? error) };
  }
}
async function write(path, text) {
  const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
  try { await ifs.writeFile(path, new TextEncoder().encode(text), { create: true, dataCcsid: 1208 }); } finally { ifs.close(); }
}
async function read(path) {
  const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
  try { return Buffer.from(await ifs.readFile(path)).toString("latin1"); } finally { ifs.close(); }
}
const summary = xml => {
  const h = /<testsuite\b([^>]*)>/.exec(xml)?.[1] ?? "";
  const a = k => new RegExp(`\\b${k}="([^"]*)"`).exec(h)?.[1];
  return `tests=${a("tests")} failures=${a("failures")} errors=${a("errors")}`;
};
const show = (label, r) => {
  console.log(`${r.ok ? "OK " : "NG "} ${label}`);
  if (!r.ok) for (const line of r.log.filter(l => !/^CPC21|^: /.test(l)).slice(-8)) console.log(`      ${line}`);
};

// コピー句: 定数 1 つ（テストがこれを assert する）
const COPY_BODY = "     D PROBE_ANSWER    C                   CONST(42)\n";
const copyTest = copyStatement => [
  "     H NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)",
  "      /COPY RPGUNIT/QINCLUDE,TESTCASE",
  copyStatement,
  "     PTESTCOPY         B                   EXPORT",
  "     DTESTCOPY         PI",
  "     C                   CALLP     iEqual(42:PROBE_ANSWER)",
  "     PTESTCOPY         E",
  ""
].join("\n");

const created = [];
try {
  await cl(`CHGLIBL LIBL(RPGUNIT ${LIB} QGPL QTEMP) CURLIB(*CRTDFT)`);
  // ジョブの CCSID（SQL ジョブは 65535 のことがある。65535 だと UTF-8 のストリームを変換できない）
  const ccsid = async () => {
    try { return (await hs.query(db, "SELECT CCSID, DEFAULT_CCSID FROM TABLE(QSYS2.ACTIVE_JOB_INFO(JOB_NAME_FILTER => '*', DETAILED_INFO => 'ALL'))")).rows[0]; }
    catch (error) { return String(error.message ?? error).slice(0, 120); }
  };
  console.log("ジョブの CCSID:", JSON.stringify(await ccsid()));
  if (process.env.PROBE_JOB_CCSID) {
    show(`CHGJOB CCSID(${process.env.PROBE_JOB_CCSID})`, await cl(`CHGJOB CCSID(${process.env.PROBE_JOB_CCSID})`));
    console.log("変更後:", JSON.stringify(await ccsid()));
  }
  for (const d of [DIR, `${DIR}/qcopy`, `${DIR}/test`]) await cl(`MKDIR DIR('${d}')`);
  await write(`${DIR}/test/tifsp1.test.rpgle`, basicSource(false));
  await write(`${DIR}/qcopy/probe_h.rpgleinc`, COPY_BODY);
  await write(`${DIR}/test/tifsp2.test.rpgle`, copyTest("      /COPY qcopy/probe_h.rpgleinc"));
  await write(`${DIR}/test/probe_s.rpgleinc`, COPY_BODY);
  await write(`${DIR}/test/tifsp3.test.rpgle`, copyTest("      /COPY probe_s.rpgleinc"));

  console.log("== P1: SRCSTMF で作る・走らせる");
  const p1 = await cl(`RPGUNIT/RUCRTRPG TSTPGM(${LIB}/TIFSP1) SRCSTMF('${DIR}/test/tifsp1.test.rpgle') TGTCCSID(0)`);
  created.push("TIFSP1");
  show("RUCRTRPG SRCSTMF", p1);
  if (p1.ok) {
    await cl(`RPGUNIT/RUCALLTST TSTPGM(${LIB}/TIFSP1) OUTPUT(*NONE) XMLSTMF('${DIR}/p1.xml')`);
    console.log(`    結果: ${summary(await read(`${DIR}/p1.xml`))}`);
  }

  console.log("== P2: 別ディレクトリのコピー句（INCDIR 無し＝対照 / 有り）");
  created.push("TIFSP2");
  show("INCDIR 無し", await cl(`RPGUNIT/RUCRTRPG TSTPGM(${LIB}/TIFSP2) SRCSTMF('${DIR}/test/tifsp2.test.rpgle') TGTCCSID(0)`));
  const p2 = await cl(`RPGUNIT/RUCRTRPG TSTPGM(${LIB}/TIFSP2) SRCSTMF('${DIR}/test/tifsp2.test.rpgle') INCDIR('${DIR}') TGTCCSID(0)`);
  show(`INCDIR('${DIR}')`, p2);
  if (p2.ok) {
    await cl(`RPGUNIT/RUCALLTST TSTPGM(${LIB}/TIFSP2) OUTPUT(*NONE) XMLSTMF('${DIR}/p2.xml')`);
    console.log(`    結果: ${summary(await read(`${DIR}/p2.xml`))}`);
  }

  console.log("== P3: ソースと同じディレクトリのコピー句（INCDIR 無し）");
  created.push("TIFSP3");
  show("INCDIR 無し", await cl(`RPGUNIT/RUCRTRPG TSTPGM(${LIB}/TIFSP3) SRCSTMF('${DIR}/test/tifsp3.test.rpgle') TGTCCSID(0)`));
} finally {
  for (const name of created) await cl(`DLTOBJ OBJ(${LIB}/${name}) OBJTYPE(*SRVPGM)`);
  for (const f of ["test/tifsp1.test.rpgle", "test/tifsp2.test.rpgle", "test/tifsp3.test.rpgle", "test/probe_s.rpgleinc",
    "qcopy/probe_h.rpgleinc", "p1.xml", "p2.xml"]) await cl(`RMVLNK OBJLNK('${DIR}/${f}')`);
  for (const d of [`${DIR}/qcopy`, `${DIR}/test`, DIR]) await cl(`RMDIR DIR('${d}')`);
  const left = await hs.query(db, `SELECT OBJNAME FROM TABLE(QSYS2.OBJECT_STATISTICS('${LIB}','*ALL')) WHERE OBJNAME LIKE 'TIFSP%'`);
  const leftIfs = await hs.query(db, `SELECT COUNT(*) AS N FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(START_PATH_NAME => '${process.env.AS400_IFS_DIR}', SUBTREE_DIRECTORIES => 'NO')) WHERE CAST(PATH_NAME AS VARCHAR(1024)) LIKE '%rpgifsprb%'`);
  console.log(`残存: オブジェクト ${left.rows.length} / IFS ${leftIfs.rows[0].N}`);
  db.close();
}
