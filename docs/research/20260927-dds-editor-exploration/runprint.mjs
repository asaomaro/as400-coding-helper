/**
 * 帳票プログラムを SQL ジョブで実行し、出来たスプール（CMPLXP）の中身を取り出して表示する（スプールは消さない）。
 *   cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify <このファイル> [プログラム] [スプール名]
 */
import { writeFileSync } from "node:fs";
import { connectHostServer } from "../../../vscode-extension/dev/rpgunit-e2e-fixtures.mjs";
const [pgm = "CMPLXPR", spl = "CMPLXP"] = process.argv.slice(2);
const LIB = process.env.AS400_LIB.toUpperCase();
const { hs, creds } = await connectHostServer();
const db = await hs.DbConnection.connect({ ...creds, resolvePort: true, timeoutMs: 300000 });
const q = async sql => (await hs.query(db, sql)).rows;
try {
  await hs.executeStatement(db, "CALL QSYS2.QCMDEXC(?)", { parameters: [`CHGLIBL LIBL(${LIB} QGPL QTEMP) CURLIB(${LIB})`] });
  try { await hs.executeStatement(db, "CALL QSYS2.QCMDEXC(?)", { parameters: [`CALL ${LIB}/${pgm}`] }); console.log(`== CALL ${pgm} OK`); }
  catch (e) { console.log(`== CALL ${pgm} NG: ${String(e.message).slice(0, 200)}`); }
  const s = await q(`SELECT JOB_NAME, FILE_NUMBER AS N, TOTAL_PAGES FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
    WHERE USER_NAME = '${String(creds.user).toUpperCase()}' AND SPOOLED_FILE_NAME = '${spl}' ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 1 ROWS ONLY`);
  if (!s.length) { console.log("スプールが無い"); process.exit(1); }
  const job = String(s[0].JOB_NAME).trim();
  const rows = await q(`SELECT SPOOLED_DATA FROM TABLE(SYSTOOLS.SPOOLED_FILE_DATA(JOB_NAME => '${job}', SPOOLED_FILE_NAME => '${spl}', SPOOLED_FILE_NUMBER => ${s[0].N}))`);
  const text = rows.map(r => String(r.SPOOLED_DATA ?? "").trimEnd()).join("\n");
  writeFileSync(new URL(`./run/print-${spl}.txt`, import.meta.url), text);
  console.log(`== スプール ${spl} #${s[0].N} ${s[0].TOTAL_PAGES} ページ（JOB ${job}。消していない）\n${text}`);
} finally { db.close(); }
