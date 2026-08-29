import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const { CommandConnection, DbConnection, query } = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === "PUB400" || s.name === "PUB400");
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
console.log("--- ソースからビルドできるか（副作用の無い CHKOBJ）---");
for (const o of ["CRTLIB","CRTBNDRPG","CRTRPGMOD","CRTSRVPGM","CRTPGM","CRTCLPGM","CRTBNDCL","CRTCMD","CRTMSGF","CRTSRCPF","ADDLIBLE"]) {
  const r = await cmd.run(`CHKOBJ OBJ(QSYS/${o}) OBJTYPE(*CMD) AUT(*USE)`);
  console.log(`  ${o.padEnd(10)} ${r.success ? "使える" : "× " + (r.messages ?? []).map(m => m.id).join(",")}`);
}
console.log("--- 自分のライブラリ ---");
const db = await DbConnection.connect({ ...creds, resolvePort: true });
const r = await query(db, `SELECT OBJNAME, OBJTEXT FROM TABLE(QSYS2.OBJECT_STATISTICS('*ALLUSR','*LIB'))
  WHERE OBJNAME LIKE 'MARO%'`);
for (const row of r.rows ?? []) console.log("  ", JSON.stringify(row));
db.close(); cmd.close();
