/**
 * research: UTF-8（日本語の注記・文字リテラル入り）のテストソースを、7.3・ジョブ CCSID 5035 の
 * `RUCRTRPG SRCSTMF` に通す手を実機で比べる。
 *
 *   A: タグ 1208 のまま（対照。probe-stmf-ccsid.mjs では ASCII だけでも CPE3490）
 *   B: 1208 で置き、`CPY … TOCCSID(5035) DTAFMT(*TEXT)` で EBCDIC に変換した別ファイルを渡す
 *   C: 同じく TOCCSID(1399)（Unicode 由来の新しい日本語 EBCDIC）
 *   D: 同じく TOCCSID(943)（Shift-JIS）
 *   （E: ジョブを CHGJOB CCSID(1399) にする手は外した。下の本文の注記を参照）
 *
 * それぞれ作れたら RUCALLTST で走らせ、件数（2 件中 1 件失敗が正）を見る。
 * Code for IBM i のデプロイは `setccsid -R 1208` でタグを 1208 にする（codefori/vscode-ibmi 3.0.13
 * `src/filesystems/local/deployment.ts:296-303`）ので、A はデプロイに乗ったときの姿そのもの。
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
      .map(r => `${r.MESSAGE_ID ?? ""}: ${String(r.MESSAGE_TEXT ?? "").trim()}`).filter(l => /^(CPE|RNS|RNF|CPF|CPD)/.test(l) && !/^CPF9897/.test(l));
    return { ok: false, log };
  }
}
const tagOf = async path => (await hs.query(db, `SELECT CCSID FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(START_PATH_NAME => '${path}', SUBTREE_DIRECTORIES => 'NO'))`)).rows[0]?.CCSID;

// 日本語の注記と文字リテラルを含むテスト（TESTPASS 合格・TESTFAIL 失敗）
const SOURCE = [
  "     H NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)",
  "      * 日本語の注記：テストの説明",
  "      /COPY RPGUNIT/QINCLUDE,TESTCASE",
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

const created = [];
async function tryCompile(label, path, pgm) {
  created.push(pgm);
  const r = await cl(`RPGUNIT/RUCRTRPG TSTPGM(${LIB}/${pgm}) SRCSTMF('${path}') TGTCCSID(0)`);
  let run = "";
  if (r.ok) {
    await cl(`RPGUNIT/RUCALLTST TSTPGM(${LIB}/${pgm}) OUTPUT(*NONE) XMLSTMF('${DIR}/r.xml')`);
    const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
    try {
      const head = /<testsuite\b([^>]*)>/.exec(Buffer.from(await ifs.readFile(`${DIR}/r.xml`)).toString("latin1"))?.[1] ?? "";
      run = head.match(/(tests|failures|errors)="\d+"/g)?.join(" ") ?? "(XML なし)";
    } catch (e) { run = `XML を読めない: ${e.message}`; } finally { ifs.close(); }
    await cl(`RMVLNK OBJLNK('${DIR}/r.xml')`);
  }
  console.log(`${r.ok ? "OK" : "NG"}  ${label}（タグ ${await tagOf(path)}）${run ? `  実行: ${run}` : ""}`);
  for (const l of r.log.slice(0, 4)) console.log(`      ${l}`);
}

try {
  await cl(`CHGLIBL LIBL(RPGUNIT ${LIB} QGPL QTEMP) CURLIB(*CRTDFT)`);
  await cl(`MKDIR DIR('${DIR}')`);
  const src = `${DIR}/tjp.test.rpgle`;
  const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
  try { await ifs.writeFile(src, new TextEncoder().encode(SOURCE), { create: true, dataCcsid: 1208 }); } finally { ifs.close(); }

  await tryCompile("A: 1208 のまま", src, "TJPA");
  for (const [tag, ccsid] of [["B", 5035], ["C", 1399], ["D", 943]]) {
    const out = `${DIR}/tjp${ccsid}.rpgle`;
    const c = await cl(`CPY OBJ('${src}') TOOBJ('${out}') TOCCSID(${ccsid}) DTAFMT(*TEXT) REPLACE(*YES)`);
    if (!c.ok) { console.log(`NG  ${tag}: CPY TOCCSID(${ccsid}) が失敗`); for (const l of c.log) console.log(`      ${l}`); continue; }
    await tryCompile(`${tag}: CPY TOCCSID(${ccsid}) DTAFMT(*TEXT)`, out, `TJP${tag}`);
    await cl(`RMVLNK OBJLNK('${out}')`);
  }
  // E（ジョブを CHGJOB CCSID(1399) にして 1208 のまま渡す）は外した。1399 にした直後の SQL の結果を
  // ts5250 の hostserver が復号できず（`unsupported CCSID 5123`）、判定まで届かない。接続のジョブの CCSID を
  // 変える手はほかの処理（結果の読み取り）も巻き込むので、手としても採らない（research.md F3）。
  await cl(`RMVLNK OBJLNK('${src}')`);
} finally {
  for (const name of created) await cl(`DLTOBJ OBJ(${LIB}/${name}) OBJTYPE(*SRVPGM)`);
  await cl(`RMDIR DIR('${DIR}')`);
  const left = await hs.query(db, `SELECT OBJNAME FROM TABLE(QSYS2.OBJECT_STATISTICS('${LIB}','*ALL')) WHERE OBJNAME LIKE 'TJP%'`);
  const leftIfs = await hs.query(db, `SELECT COUNT(*) AS N FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(START_PATH_NAME => '${process.env.AS400_IFS_DIR}', SUBTREE_DIRECTORIES => 'NO')) WHERE CAST(PATH_NAME AS VARCHAR(1024)) LIKE '%rpgifsprb%'`);
  console.log(`残存: オブジェクト ${left.rows.length} / IFS ${leftIfs.rows[0].N}`);
  db.close();
}
