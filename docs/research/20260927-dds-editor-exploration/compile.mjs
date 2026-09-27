/**
 * 探索で作ったソースを実機（SR-OSAKA）でコンパイルし、ジョブログとコンパイル・リストの誤りを出す。
 *
 *   cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify <このファイル> <種別> <ソース> [名前] [追加パラメーター]
 *     種別: dspf | prtf | pf | rpgle
 *
 * ソースは UTF-8 のまま IFS に置き、CPYFRMSTMF でソース物理ファイル（ASAOLIB/QDDSSRC・QRPGLESRC、CCSID 5035）の
 * メンバーへ写す。リストはスプール（名前はオブジェクト名）から誤りの行（`*` 付きの下線・メッセージ番号・MESSAGE SUMMARY）だけを抜く。
 * スプールは消さない。
 */
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { connectHostServer } from "../../../vscode-extension/dev/rpgunit-e2e-fixtures.mjs";

const [kind, path, nameArg, ...extra] = process.argv.slice(2);
const LIB = process.env.AS400_LIB.toUpperCase();
const IFS = process.env.AS400_IFS_DIR;
const name = (nameArg ?? basename(path, extname(path))).toUpperCase();
// 既存の QDDSSRC は CCSID 1027（1 バイト文字だけ）で DBCS が落ちる。触らずに 5035 の別ファイルを使う
const srcFile = kind === "rpgle" ? "QRPGLESRC" : kind === "clle" ? "QCLSRCJ" : "QDDSJ";
const srcType = { dspf: "DSPF", prtf: "PRTF", pf: "PF", rpgle: "RPGLE", clle: "CLLE" }[kind];
const create = {
  dspf: `CRTDSPF FILE(${LIB}/${name}) SRCFILE(${LIB}/${srcFile}) SRCMBR(${name}) OPTION(*SRC *LIST) REPLACE(*YES)`,
  prtf: `CRTPRTF FILE(${LIB}/${name}) SRCFILE(${LIB}/${srcFile}) SRCMBR(${name}) OPTION(*SRC *LIST) REPLACE(*YES)`,
  pf: `CRTPF FILE(${LIB}/${name}) SRCFILE(${LIB}/${srcFile}) SRCMBR(${name}) OPTION(*SRC *LIST)`,
  clle: `CRTBNDCL PGM(${LIB}/${name}) SRCFILE(${LIB}/${srcFile}) SRCMBR(${name}) REPLACE(*YES)`,
  rpgle: `CRTBNDRPG PGM(${LIB}/${name}) SRCFILE(${LIB}/${srcFile}) SRCMBR(${name}) OPTION(*SRCSTMT) DBGVIEW(*SOURCE) REPLACE(*YES)`
}[kind] + (extra.length ? ` ${extra.join(" ")}` : "");

const { hs, creds } = await connectHostServer();
const db = await hs.DbConnection.connect({ ...creds, resolvePort: true, timeoutMs: 300000 });
const q = async sql => (await hs.query(db, sql)).rows;
const lastLog = async () => Number((await q("SELECT COALESCE(MAX(ORDINAL_POSITION),0) AS N FROM TABLE(QSYS2.JOBLOG_INFO('*'))"))[0].N);
async function cl(command) {
  const since = await lastLog();
  try { await hs.executeStatement(db, "CALL QSYS2.QCMDEXC(?)", { parameters: [command] }); return { ok: true, log: await logSince(since) }; }
  catch { return { ok: false, log: await logSince(since) }; }
}
async function logSince(since) {
  return (await q(`SELECT MESSAGE_ID, MESSAGE_TEXT FROM TABLE(QSYS2.JOBLOG_INFO('*')) WHERE ORDINAL_POSITION > ${since} ORDER BY ORDINAL_POSITION`))
    .map(r => `${r.MESSAGE_ID ?? ""}: ${String(r.MESSAGE_TEXT ?? "").trim()}`);
}

try {
  const job = String((await q("VALUES QSYS2.JOB_NAME"))[0][Object.keys((await q("VALUES QSYS2.JOB_NAME"))[0])[0]]).trim();
  await cl(`CHGLIBL LIBL(${LIB} QGPL QTEMP) CURLIB(${LIB})`);
  await cl(`CRTSRCPF FILE(${LIB}/${srcFile}) RCDLEN(112) CCSID(5035) IGCDTA(*YES)`);
  const stmf = `${IFS}/${name}.${kind}.src`;
  const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
  try { await ifs.writeFile(stmf, new Uint8Array(readFileSync(path)), { create: true, dataCcsid: 1208 }); } finally { ifs.close(); }
  const cpy = await cl(`CPYFRMSTMF FROMSTMF('${stmf}') TOMBR('/QSYS.LIB/${LIB}.LIB/${srcFile}.FILE/${name}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await cl(`RMVLNK OBJLNK('${stmf}')`);
  console.log(`== 転送 ${cpy.ok ? "OK" : "NG"}`);
  for (const l of cpy.log.filter(l => !/^CPC2/.test(l))) console.log(`   ${l}`);
  await cl(`CHGPFM FILE(${LIB}/${srcFile}) MBR(${name}) SRCTYPE(${srcType})`);
  const made = await cl(create);
  console.log(`== ${create}\n== ${made.ok ? "作成できた" : "作成できない"}`);
  for (const l of made.log.filter(l => /^(CPD|CPF|RNF|RNS|CPI)/.test(l))) console.log(`   ${l}`);

  // コンパイル・リスト（この SQL ジョブのスプール。名前はオブジェクト名）の最後の 1 本から誤りの行を抜く
  const spl = await q(`SELECT FILE_NUMBER AS N, JOB_NAME FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
    WHERE USER_NAME = '${String(creds.user).toUpperCase()}' AND SPOOLED_FILE_NAME = '${name}' AND CREATE_TIMESTAMP > CURRENT TIMESTAMP - 5 MINUTES
    ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 1 ROWS ONLY`)
    .catch(error => { console.log(`== スプールを引けない: ${String(error.message ?? error).slice(0, 200)}`); return []; });
  if (!spl.length) console.log(`   （JOB ${job}）`);
  if (spl.length) {
    const rows = await q(`SELECT SPOOLED_DATA FROM TABLE(SYSTOOLS.SPOOLED_FILE_DATA(JOB_NAME => '${String(spl[0].JOB_NAME).trim()}', SPOOLED_FILE_NAME => '${name}', SPOOLED_FILE_NUMBER => ${spl[0].N}))`);
    const lines = rows.map(r => String(r.SPOOLED_DATA ?? ""));
    const start = lines.findIndex(l => /MESSAGE SUMMARY|メッセージ要約|Message Summary/i.test(l));
    const errs = lines.filter(l => /\b(CPD|CPF|RNF)\d{4}\b|^\s*\*{3,}|^ {0,12}[0-9A-F]{4}  /.test(l)).slice(0, 60);
    console.log(`== リスト ${name} #${spl[0].N}（スプールは消していない。JOB ${String(spl[0].JOB_NAME).trim()}）`);
    for (const l of (process.env.DUMP_LIST ? lines : errs)) console.log(`   | ${l.trimEnd()}`);
    if (start >= 0) for (const l of lines.slice(start, start + 25)) console.log(`   S ${l.trimEnd()}`);
  } else {
    console.log("== リストのスプールが見つからない");
  }
} finally {
  db.close();
}
