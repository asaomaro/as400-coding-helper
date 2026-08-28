import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const { CommandConnection, DbConnection, query } = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
try {
  const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
  const r = await cmd.run("DSPLIBL OUTPUT(*PRINT)");
  console.log("コマンド接続: OK", r.success);
  await cmd.run("DLTSPLF FILE(QPDSPLIB) SPLNBR(*LAST)").catch(() => {});
  cmd.close();
} catch (e) { console.log("コマンド接続: 失敗", String(e).slice(0, 120)); }
try {
  const db = await DbConnection.connect({ ...creds, resolvePort: true });
  const r = await query(db, "SELECT 1 AS OK FROM SYSIBM.SYSDUMMY1");
  console.log("SQL 接続: OK", JSON.stringify(r.rows));
  db.close();
} catch (e) { console.log("SQL 接続: 失敗", String(e).slice(0, 120)); }
