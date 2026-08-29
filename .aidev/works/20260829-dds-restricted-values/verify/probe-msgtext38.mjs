// CPD7410（Q と 0 に出た）と CPD7443 / CPD7436 / CPD5238（H / M / P に出た）が
// 「値が無効」なのか「文脈が違う」なのかを本文で確かめる。
// **「弾かれた＝無効な値」と読むのは不在証明**。RPG III で同じ形を踏んでいる。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const { DbConnection, query } = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const db = await DbConnection.connect({ ...creds, resolvePort: true });
try {
  const r = await query(db, `SELECT MESSAGE_ID, MESSAGE_TEXT FROM QSYS2.MESSAGE_FILE_DATA
    WHERE MESSAGE_FILE = 'QDDSMSG' AND MESSAGE_ID IN ('CPD7410','CPD7443','CPD7436','CPD5238','CPD8049')
    ORDER BY MESSAGE_ID`);
  for (const row of r.rows ?? []) console.log(`${row.MESSAGE_ID}: ${row.MESSAGE_TEXT}`);
  if (!(r.rows ?? []).length) {
    const f = await query(db, `SELECT DISTINCT MESSAGE_FILE FROM QSYS2.MESSAGE_FILE_DATA WHERE MESSAGE_ID='CPD7410'`);
    console.log("QDDSMSG に無い。ある場所:", JSON.stringify(f.rows));
  }
} finally { db.close(); }
