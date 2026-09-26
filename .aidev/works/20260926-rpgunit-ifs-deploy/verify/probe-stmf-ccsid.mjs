/**
 * probe-srcstmf.mjs の続き。RUCRTRPG SRCSTMF が CPE3490（変換エラー）で開けなかった原因を切り分ける。
 * ジョブの CCSID は 5035（対照の CHGJOB でも変わらず）。残る候補はストリーム・ファイルに付いたタグ。
 * 同じ中身（ASCII の範囲だけ）を タグ 1208 / 819 / 943 / 1252 で置き、それぞれ RUCRTRPG に通す。
 * 付いたタグは IFS_OBJECT_STATISTICS で読み戻す（writeFile の dataCcsid が効いているか）。
 */
import { basicSource, connectHostServer } from "../../../../vscode-extension/dev/rpgunit-e2e-fixtures.mjs";

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
      .map(r => `${r.MESSAGE_ID ?? ""}: ${String(r.MESSAGE_TEXT ?? "").trim()}`).filter(l => /^(CPE|RNS|RNF|CPF)/.test(l) && !/^CPF9897/.test(l));
    return { ok: false, log };
  }
}
const CCSIDS = (process.env.PROBE_CCSIDS ?? "1208,819,943,1252").split(",").map(Number);
const created = [];
try {
  await cl(`CHGLIBL LIBL(RPGUNIT ${LIB} QGPL QTEMP) CURLIB(*CRTDFT)`);
  await cl(`MKDIR DIR('${DIR}')`);
  for (const ccsid of CCSIDS) {
    const path = `${DIR}/t${ccsid}.test.rpgle`;
    const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
    try { await ifs.writeFile(path, new TextEncoder().encode(basicSource(false)), { create: true, dataCcsid: ccsid }); } finally { ifs.close(); }
    const tag = (await hs.query(db, `SELECT CCSID FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(START_PATH_NAME => '${path}', SUBTREE_DIRECTORIES => 'NO'))`)).rows[0]?.CCSID;
    const pgm = `TIFS${ccsid}`.slice(0, 10);
    created.push(pgm);
    const r = await cl(`RPGUNIT/RUCRTRPG TSTPGM(${LIB}/${pgm}) SRCSTMF('${path}') TGTCCSID(0)`);
    console.log(`タグ指定 ${ccsid} → 実際のタグ ${tag}: ${r.ok ? "OK（作成できた）" : "NG"}`);
    for (const l of r.log.slice(0, 4)) console.log(`      ${l}`);
    if (r.ok) {
      await cl(`RPGUNIT/RUCALLTST TSTPGM(${LIB}/${pgm}) OUTPUT(*NONE) XMLSTMF('${DIR}/r.xml')`);
      const ifs2 = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
      try {
        const head = /<testsuite\b([^>]*)>/.exec(Buffer.from(await ifs2.readFile(`${DIR}/r.xml`)).toString("latin1"))?.[1] ?? "";
        console.log(`      実行: ${head.match(/(tests|failures|errors)="\d+"/g)?.join(" ")}`);
      } finally { ifs2.close(); }
      await cl(`RMVLNK OBJLNK('${DIR}/r.xml')`);
    }
    await cl(`RMVLNK OBJLNK('${path}')`);
  }
} finally {
  for (const name of created) await cl(`DLTOBJ OBJ(${LIB}/${name}) OBJTYPE(*SRVPGM)`);
  await cl(`RMDIR DIR('${DIR}')`);
  const left = await hs.query(db, `SELECT OBJNAME FROM TABLE(QSYS2.OBJECT_STATISTICS('${LIB}','*ALL')) WHERE OBJNAME LIKE 'TIFS%'`);
  console.log(`残存: オブジェクト ${left.rows.length}`);
  db.close();
}
