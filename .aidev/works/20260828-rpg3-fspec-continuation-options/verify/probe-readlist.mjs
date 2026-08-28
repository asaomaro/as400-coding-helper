// リストの読み方を確かめる。**30 件を読むので軽い経路が要る。**
// 前 work は host_get_spool で 1 件 18k トークン。SQL で行を絞れるなら桁違いに軽い。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const hs = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };

const db = await hs.DbConnection.connect({ ...creds, resolvePort: true });
try {
  const q = async (label, sql) => {
    try {
      const r = await db.query(sql);
      console.log(`--- ${label} ---`);
      console.log(JSON.stringify(r.rows?.slice(0, 4) ?? r, null, 1).slice(0, 900));
    } catch (e) { console.log(`--- ${label} --- 失敗: ${String(e).slice(0, 200)}`); }
  };
  await q("接続確認", "SELECT 1 AS OK FROM SYSIBM.SYSDUMMY1");
  await q("SPOOLED_FILE_DATA があるか",
    "SELECT ROUTINE_NAME FROM QSYS2.SYSROUTINES WHERE ROUTINE_SCHEMA='SYSTOOLS' AND ROUTINE_NAME LIKE 'SPOOL%'");
  await q("直近の QRPGLST",
    "SELECT JOB_NAME, FILE_NUMBER, CREATE_TIMESTAMP FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC WHERE SPOOLED_FILE_NAME='QRPGLST' ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 3 ROWS ONLY");
} finally { db.close(); }
