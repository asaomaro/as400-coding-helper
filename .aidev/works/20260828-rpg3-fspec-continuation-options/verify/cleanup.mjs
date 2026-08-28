// 実機の片付けと確認。**probe の DLTSPLF は JOB() の書式を誤っており**
// `.catch(()=>{})` で握り潰されていたため、スプールが残っている。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const { CommandConnection, DbConnection, IfsConnection, query } =
  await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;

const NAMES = ["K00","K01","K98","K99","M01","M02","M03","M04",
  ...Array.from({length:30},(_,i)=>`C${String(i).padStart(2,"0")}`)];

const db = await DbConnection.connect({ ...creds, resolvePort: true });
const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
try {
  const before = await query(db, `SELECT COUNT(*) AS N FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
    WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME IN (${NAMES.map(n=>`'${n}'`).join(",")})`);
  console.log("残っていたスプール:", before.rows[0].N);

  const list = await query(db, `SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
    WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME IN (${NAMES.map(n=>`'${n}'`).join(",")})`);
  let removed = 0;
  for (const row of list.rows ?? []) {
    // **JOB() は 番号/ユーザー/名前 をそのまま渡す**（`#番号` を付けない。前回の誤り）。
    const r = await cmd.run(`DLTSPLF FILE(${row.SPOOLED_FILE_NAME}) JOB(${row.JOB_NAME}) SPLNBR(${row.FILE_NUMBER})`);
    if (r.success) removed += 1;
  }
  console.log("消したスプール:", removed);

  const objs = await query(db, `SELECT OBJNAME, OBJTYPE FROM TABLE(QSYS2.OBJECT_STATISTICS('${LIB}','*ALL'))
    WHERE OBJCREATED > CURRENT TIMESTAMP - 6 HOURS`);
  console.log("6 時間以内に作ったオブジェクト:", JSON.stringify(objs.rows ?? []));

  const after = await query(db, `SELECT COUNT(*) AS N FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
    WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME IN (${NAMES.map(n=>`'${n}'`).join(",")})`);
  console.log("残りスプール:", after.rows[0].N);
} finally { cmd.close(); db.close(); }

const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try {
  const left = [];
  for (const n of NAMES) {
    try { await ifs.deleteFile(`${IFS}/${n}.rpg`); left.push(n); } catch { /* もう無い */ }
  }
  console.log("消し残していた IFS ファイル:", left.length ? left.join(",") : "なし");
} finally { ifs.close(); }
