// 片付けは「消すコマンドを呼んだ」ではなく「**残っていないこと**を数えて」確かめる。
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
const NAMES = ["X38","D35","P35","P38","R35","C1","C2","V1","G1","O1","B1","PF1","PF2",
  ...Array.from({length:11},(_,i)=>`P${String(i).padStart(2,"0")}`)];

const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
const db = await DbConnection.connect({ ...creds, resolvePort: true });
try {
  const list = await query(db, `SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
    WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME IN (${NAMES.map(n=>`'${n}'`).join(",")})`);
  console.log("残っていたスプール:", (list.rows ?? []).length);
  let removed = 0;
  for (const row of list.rows ?? []) {
    const r = await cmd.run(`DLTSPLF FILE(${row.SPOOLED_FILE_NAME}) JOB(${row.JOB_NAME}) SPLNBR(${row.FILE_NUMBER})`);
    if (r.success) removed += 1;
  }
  console.log("消したスプール:", removed);
  const objs = await query(db, `SELECT OBJNAME, OBJTYPE FROM TABLE(QSYS2.OBJECT_STATISTICS('${LIB}','*ALL'))
    WHERE OBJCREATED > CURRENT TIMESTAMP - 4 HOURS`);
  console.log("4 時間以内に作ったオブジェクト:", JSON.stringify(objs.rows ?? []));
  const after = await query(db, `SELECT COUNT(*) AS N FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
    WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME IN (${NAMES.map(n=>`'${n}'`).join(",")})`);
  console.log("残りスプール:", after.rows[0].N);
} finally { cmd.close(); db.close(); }

const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try {
  const left = [];
  for (const n of NAMES) for (const ext of ["dds","dspf"]) {
    try { await ifs.deleteFile(`${IFS}/${n}.${ext}`); left.push(`${n}.${ext}`); } catch { /* 無い */ }
  }
  console.log("消し残していた IFS ファイル:", left.length ? left.join(",") : "なし");
} finally { ifs.close(); }
