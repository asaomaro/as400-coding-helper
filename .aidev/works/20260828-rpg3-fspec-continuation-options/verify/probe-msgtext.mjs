// QRG2023 の本文が有効な語を並べていないかを確かめる。
// リストには並ばなかったが、**メッセージ・ファイルの 2 次テキスト**は別物なので見る。
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
  const r = await query(db, `SELECT MESSAGE_ID, MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT
    FROM QSYS2.MESSAGE_FILE_DATA
    WHERE MESSAGE_FILE = 'QRPGMSG' AND MESSAGE_ID IN ('RPG2023','RPG2067','RPG2075')`);
  for (const row of r.rows ?? []) {
    console.log(`=== ${row.MESSAGE_ID} ===`);
    console.log("1 次:", row.MESSAGE_TEXT);
    console.log("2 次:", (row.MESSAGE_SECOND_LEVEL_TEXT ?? "(なし)").slice(0, 1200));
  }
  if (!(r.rows ?? []).length) {
    const f = await query(db, `SELECT DISTINCT MESSAGE_FILE FROM QSYS2.MESSAGE_FILE_DATA
      WHERE MESSAGE_ID LIKE 'RPG20%' FETCH FIRST 5 ROWS ONLY`);
    console.log("QRPGMSG に無い。候補のファイル:", JSON.stringify(f.rows));
  }
} finally { db.close(); }
