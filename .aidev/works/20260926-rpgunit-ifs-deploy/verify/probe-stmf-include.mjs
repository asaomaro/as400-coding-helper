/**
 * research: 変換（`CPY … TOCCSID(5035) DTAFMT(*TEXT)`）したテストソースから、IFS のコピー句がどう解決されるか。
 * Code for IBM i のデプロイと同じく、元のファイルは UTF-8・タグ 1208 で置く（`src/` 配下）。
 *
 *   I1: テストだけ変換し、コピー句は 1208 のまま。INCDIR に元のディレクトリ → コピー句も開けないか
 *   I2: ツリーごと変換（`CPY … SUBTREE(*ALL)`）し、INCDIR に変換先の最上位 → 通るか
 *   I3: I2 から INCDIR を外す（対照） → 相対パスのコピー句が見つからないか
 *   I4: テストと同じディレクトリのコピー句を、INCDIR 無しで → ソースのディレクトリから探すか
 *   I5: テストだけ別の場所へ変換し、同じディレクトリのコピー句（1208）を INCDIR（元のテストのディレクトリ）で
 *   I6: I5 から INCDIR を外す（対照）
 *
 * 通ったものは RUCALLTST で走らせる（TESTCOPY 合格が正）。
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
async function write(path, text) {
  const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
  try { await ifs.writeFile(path, new TextEncoder().encode(text), { create: true, dataCcsid: 1208 }); } finally { ifs.close(); }
}

const COPY_BODY = "      * 日本語の注記（コピー句）\n     D PROBE_ANSWER    C                   CONST(42)\n";
const copyTest = copyStatement => [
  "     H NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)",
  "      * 日本語の注記",
  "      /COPY RPGUNIT/QINCLUDE,TESTCASE",
  copyStatement,
  "     PTESTCOPY         B                   EXPORT",
  "     DTESTCOPY         PI",
  "     C                   CALLP     iEqual(42:PROBE_ANSWER)",
  "     PTESTCOPY         E",
  ""
].join("\n");

const created = [];
async function compile(label, pgm, stmf, incdir) {
  created.push(pgm);
  const r = await cl(`RPGUNIT/RUCRTRPG TSTPGM(${LIB}/${pgm}) SRCSTMF('${stmf}')${incdir ? ` INCDIR('${incdir}')` : ""} TGTCCSID(0)`);
  let run = "";
  if (r.ok) {
    await cl(`RPGUNIT/RUCALLTST TSTPGM(${LIB}/${pgm}) OUTPUT(*NONE) XMLSTMF('${DIR}/r.xml')`);
    const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
    try {
      const head = /<testsuite\b([^>]*)>/.exec(Buffer.from(await ifs.readFile(`${DIR}/r.xml`)).toString("latin1"))?.[1] ?? "";
      run = head.match(/(tests|failures|errors)="\d+"/g)?.join(" ") ?? "";
    } finally { ifs.close(); }
    await cl(`RMVLNK OBJLNK('${DIR}/r.xml')`);
  }
  console.log(`${r.ok ? "OK" : "NG"}  ${label}${run ? `  実行: ${run}` : ""}`);
  for (const l of r.log.slice(0, 4)) console.log(`      ${l}`);
}

try {
  await cl(`CHGLIBL LIBL(RPGUNIT ${LIB} QGPL QTEMP) CURLIB(*CRTDFT)`);
  for (const d of [DIR, `${DIR}/src`, `${DIR}/src/qcopy`, `${DIR}/src/test`, `${DIR}/one`, `${DIR}/conv`]) await cl(`MKDIR DIR('${d}')`);
  await write(`${DIR}/src/qcopy/probe_h.rpgleinc`, COPY_BODY);
  await write(`${DIR}/src/test/tinc.test.rpgle`, copyTest("      /COPY qcopy/probe_h.rpgleinc"));
  await write(`${DIR}/src/test/probe_s.rpgleinc`, COPY_BODY);
  await write(`${DIR}/src/test/tsame.test.rpgle`, copyTest("      /COPY probe_s.rpgleinc"));

  console.log("== I1: テストだけ変換・コピー句は 1208 のまま");
  await cl(`CPY OBJ('${DIR}/src/test/tinc.test.rpgle') TOOBJ('${DIR}/one/tinc.test.rpgle') TOCCSID(5035) DTAFMT(*TEXT) REPLACE(*YES)`);
  await compile(`INCDIR('${DIR}/src')`, "TINC1", `${DIR}/one/tinc.test.rpgle`, `${DIR}/src`);

  console.log("== I5・I6: テストだけ別の場所へ変換・同じディレクトリのコピー句は 1208 のまま");
  await cl(`CPY OBJ('${DIR}/src/test/tsame.test.rpgle') TOOBJ('${DIR}/one/tsame.test.rpgle') TOCCSID(5035) DTAFMT(*TEXT) REPLACE(*YES)`);
  await compile(`I5: INCDIR('${DIR}/src/test')`, "TINC5", `${DIR}/one/tsame.test.rpgle`, `${DIR}/src/test`);
  await compile("I6: INCDIR 無し（対照）", "TINC6", `${DIR}/one/tsame.test.rpgle`);

  console.log("== I2〜I4: ツリーごと変換");
  const tree = await cl(`CPY OBJ('${DIR}/src') TODIR('${DIR}/conv') SUBTREE(*ALL) TOCCSID(5035) DTAFMT(*TEXT) REPLACE(*YES)`);
  console.log(`${tree.ok ? "OK" : "NG"}  CPY SUBTREE(*ALL) TOCCSID(5035) DTAFMT(*TEXT)`);
  for (const l of tree.log.slice(0, 4)) console.log(`      ${l}`);
  const listed = await hs.query(db, `SELECT CAST(PATH_NAME AS VARCHAR(1024)) AS P, CCSID FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(START_PATH_NAME => '${DIR}/conv', SUBTREE_DIRECTORIES => 'YES')) WHERE OBJECT_TYPE = '*STMF'`).catch(e => ({ rows: [{ P: String(e.message).slice(0, 100) }] }));
  for (const r of listed.rows) console.log(`      ${String(r.P).trim()}  タグ ${r.CCSID}`);
  const conv = `${DIR}/conv/src`;
  await compile(`I2: INCDIR('${conv}')`, "TINC2", `${conv}/test/tinc.test.rpgle`, conv);
  await compile("I3: INCDIR 無し（対照）", "TINC3", `${conv}/test/tinc.test.rpgle`);
  await compile("I4: 同じディレクトリのコピー句・INCDIR 無し", "TINC4", `${conv}/test/tsame.test.rpgle`);
} finally {
  for (const name of created) await cl(`DLTOBJ OBJ(${LIB}/${name}) OBJTYPE(*SRVPGM)`);
  const files = await hs.query(db, `SELECT CAST(PATH_NAME AS VARCHAR(1024)) AS P FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(START_PATH_NAME => '${DIR}', SUBTREE_DIRECTORIES => 'YES')) WHERE OBJECT_TYPE = '*STMF'`).catch(() => ({ rows: [] }));
  for (const f of files.rows) await cl(`RMVLNK OBJLNK('${String(f.P).trim()}')`);
  const dirs = await hs.query(db, `SELECT CAST(PATH_NAME AS VARCHAR(1024)) AS P FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(START_PATH_NAME => '${DIR}', SUBTREE_DIRECTORIES => 'YES')) WHERE OBJECT_TYPE = '*DIR' ORDER BY LENGTH(CAST(PATH_NAME AS VARCHAR(1024))) DESC`).catch(() => ({ rows: [] }));
  for (const d of dirs.rows) await cl(`RMDIR DIR('${String(d.P).trim()}')`);
  const left = await hs.query(db, `SELECT OBJNAME FROM TABLE(QSYS2.OBJECT_STATISTICS('${LIB}','*ALL')) WHERE OBJNAME LIKE 'TINC%'`);
  const leftIfs = await hs.query(db, `SELECT COUNT(*) AS N FROM TABLE(QSYS2.IFS_OBJECT_STATISTICS(START_PATH_NAME => '${process.env.AS400_IFS_DIR}', SUBTREE_DIRECTORIES => 'NO')) WHERE CAST(PATH_NAME AS VARCHAR(1024)) LIKE '%rpgifsprb%'`);
  console.log(`残存: オブジェクト ${left.rows.length} / IFS ${leftIfs.rows[0].N}`);
  db.close();
}
