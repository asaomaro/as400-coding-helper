/** pub400 の権限まわりを**読み取りだけ**で調べる（導入可否の材料集め）。 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const { DbConnection, query, CommandConnection } = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === "PUB400" || s.name === "PUB400");
if (!sys) { console.log("PUB400 の設定が無い"); process.exit(2); }
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
console.log("接続先:", sys.host, "user:", sys.signon.user);
const db = await DbConnection.connect({ ...creds, resolvePort: true });
const q = async (sql, label) => {
  try { const r = await query(db, sql); console.log(`--- ${label} ---`); for (const row of (r.rows ?? []).slice(0, 12)) console.log("  ", JSON.stringify(row)); if (!(r.rows ?? []).length) console.log("   (0 件)"); }
  catch (e) { console.log(`--- ${label} --- 取得できず: ${String(e.message).slice(0, 120)}`); }
};
await q(`SELECT AUTHORIZATION_NAME, SPECIAL_AUTHORITIES, USER_CLASS_NAME, LIMIT_CAPABILITIES
  FROM QSYS2.USER_INFO WHERE AUTHORIZATION_NAME = CURRENT_USER`, "自分の権限");
await q(`SELECT OBJNAME, OBJTYPE, OBJTEXT FROM TABLE(QSYS2.OBJECT_STATISTICS('*ALLUSR','*LIB'))
  WHERE OBJNAME LIKE 'RPGUNIT%' OR OBJNAME LIKE '%IRPGUNIT%'`, "RPGUNIT ライブラリの有無");
await q(`SELECT OBJNAME, OBJTYPE FROM TABLE(QSYS2.OBJECT_STATISTICS('QSYS','*CMD'))
  WHERE OBJNAME IN ('RSTLIB','RSTOBJ','CRTSAVF','RUCALLTST')`, "関係するコマンドの存在");
db.close();
// 権限の実地確認（副作用の無い CHKOBJ）
const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
for (const cl of [`CHKOBJ OBJ(QSYS/RSTLIB) OBJTYPE(*CMD) AUT(*USE)`,
                  `CHKOBJ OBJ(QSYS/CRTSAVF) OBJTYPE(*CMD) AUT(*USE)`,
                  `CHKOBJ OBJ(QSYS/RSTOBJ) OBJTYPE(*CMD) AUT(*USE)`]) {
  const r = await cmd.run(cl);
  console.log(`${cl.match(/QSYS\/(\w+)/)[1].padEnd(8)} ${r.success ? "使える" : "×"} ${(r.messages ?? []).map(m => m.id).join(",")}`);
}
cmd.close();
