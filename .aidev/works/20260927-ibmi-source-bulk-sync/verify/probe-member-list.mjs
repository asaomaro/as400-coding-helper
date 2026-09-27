/**
 * ソース・ファイルのメンバー一覧を、SSH の `system "RUNSQL ..."` 1 回で UTF-8 の IFS ファイルに
 * 書き出せるかを確かめる。ここでは同じ CL を host server の QCMDEXC で流す（SSH は検証環境に無い）。
 *
 *   cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify <このファイル>
 *
 * 書いた IFS ファイルは読んだ後に消す（自分で作ったものだけ）。メンバー・スプールには触れない。
 */
import { connectHostServer } from "../../../../vscode-extension/dev/rpgunit-e2e-fixtures.mjs";

const LIB = process.env.AS400_LIB.toUpperCase();
const IFS = process.env.AS400_IFS_DIR;
const { hs, creds } = await connectHostServer();
const db = await hs.DbConnection.connect({ ...creds, resolvePort: true, timeoutMs: 300000 });
const q = async sql => (await hs.query(db, sql)).rows;
async function cl(command) {
  try { await hs.executeStatement(db, "CALL QSYS2.QCMDEXC(?)", { parameters: [command] }); return "OK"; }
  catch (e) { return `NG ${String(e.message ?? e).slice(0, 200)}`; }
}

console.log("== OS", JSON.stringify(await q("SELECT OS_VERSION, OS_RELEASE FROM SYSIBMADM.ENV_SYS_INFO")));
console.log("== SYSPARTITIONSTAT の列");
console.log(JSON.stringify(await q(`SELECT SYSTEM_TABLE_MEMBER, SOURCE_TYPE, PARTITION_TEXT, NUMBER_ROWS,
  LAST_SOURCE_UPDATE_TIMESTAMP, LAST_CHANGE_TIMESTAMP, CREATE_TIMESTAMP
  FROM QSYS2.SYSPARTITIONSTAT WHERE SYSTEM_TABLE_SCHEMA = '${LIB}' AND SYSTEM_TABLE_NAME = 'QDDSJ'
  ORDER BY SYSTEM_TABLE_MEMBER FETCH FIRST 5 ROWS ONLY`), (k, v) => typeof v === "bigint" ? Number(v) : v, 1));

const select = (file) => `SELECT JSON_OBJECT(
  'exists' VALUE (SELECT COUNT(*) FROM QSYS2.SYSTABLES WHERE SYSTEM_TABLE_SCHEMA = '${LIB}' AND SYSTEM_TABLE_NAME = '${file}' AND FILE_TYPE = 'S'),
  'members' VALUE JSON_ARRAYAGG(JSON_OBJECT(
  'name' VALUE RTRIM(SYSTEM_TABLE_MEMBER), 'type' VALUE RTRIM(COALESCE(SOURCE_TYPE, '')),
  'text' VALUE RTRIM(COALESCE(PARTITION_TEXT, '')), 'lines' VALUE NUMBER_ROWS,
  'changed' VALUE VARCHAR_FORMAT(COALESCE(LAST_SOURCE_UPDATE_TIMESTAMP, LAST_CHANGE_TIMESTAMP) - CURRENT TIMEZONE, 'YYYY-MM-DD HH24:MI:SS')))
  FORMAT JSON) FROM QSYS2.SYSPARTITIONSTAT WHERE SYSTEM_TABLE_SCHEMA = '${LIB}' AND SYSTEM_TABLE_NAME = '${file}'`;

console.log("== CHGPFM TEXT（日本語と引用符）", await cl(`CHGPFM FILE(${LIB}/QDDSJ) MBR(KWVALD) TEXT('受注入力 "A" ''B''')`));
console.log("== 対照: 物理ファイル（ソースでない）");
console.log("== JSON_ARRAYAGG", String(Object.values((await q(select("QDDSJ")))[0])[0]).slice(0, 300));

for (const file of ["QDDSJ", "NOSUCHF", "KWVALF"]) {
  const path = `${IFS}/bulk-sync-probe-${file}.json`;
  const sql = `CALL QSYS2.IFS_WRITE_UTF8(PATH_NAME => '${path}', LINE => (${select(file)}), OVERWRITE => 'REPLACE', END_OF_LINE => 'NONE')`;
  const r = await cl(`RUNSQL SQL('${sql.replace(/'/g, "''").replace(/\s+/g, " ")}') COMMIT(*NONE)`);
  console.log(`== RUNSQL IFS_WRITE_UTF8 ${file}: ${r}`);
  const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
  try {
    const bytes = await ifs.readFile(path);
    const text = Buffer.from(bytes).toString("utf8");
    const json = JSON.parse(text);
    console.log("   読めた: exists=", json.exists, "件数=", json.members?.length ?? null, "先頭=", JSON.stringify(json.members?.[0]));
    console.log("   KWVALD=", JSON.stringify(json.members?.find(m => m.name === "KWVALD")));
  } catch (e) { console.log("   読めない:", String(e.message ?? e).slice(0, 120)); }
  finally { ifs.close(); }
  await cl(`RMVLNK OBJLNK('${path}')`);
}
console.log("== 後始末 CHGPFM TEXT(*BLANK)", await cl(`CHGPFM FILE(${LIB}/QDDSJ) MBR(KWVALD) TEXT(*BLANK)`));
console.log("== 現地時刻と TIMEZONE", JSON.stringify(await q("VALUES (VARCHAR(CURRENT TIMESTAMP), CURRENT TIMEZONE)"), (k, v) => typeof v === "bigint" ? Number(v) : v));
process.exit(0);
