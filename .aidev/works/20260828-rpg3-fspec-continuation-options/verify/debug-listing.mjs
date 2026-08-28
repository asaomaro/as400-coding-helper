import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const { DbConnection, query, NetPrintConnection } = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };

const db = await DbConnection.connect({ ...creds, resolvePort: true });
const r = await query(db, `SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME, USER_NAME, CREATE_TIMESTAMP
  FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC WHERE USER_NAME = CURRENT_USER
  ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 5 ROWS ONLY`);
console.log("スプール一覧:", JSON.stringify(r.rows, null, 1));
db.close();
const spool = r.rows?.[0];
if (!spool) process.exit(1);
const [jobNumber, jobUser, jobName] = String(spool.JOB_NAME).split("/");
const printer = await NetPrintConnection.connect({ ...creds, resolvePort: true });
const pages = await printer.readSpooledPages({ fileName: spool.SPOOLED_FILE_NAME, fileNumber: spool.FILE_NUMBER, jobName, jobUser, jobNumber });
printer.close();
console.log("ページ数:", pages.length, "先頭ページの型:", Object.keys(pages[0] ?? {}).join(","));
const text = pages.map(p => (p.lines ?? p.rows ?? []).map(l => (typeof l === "string" ? l : l.text ?? "")).join("\n")).join("\n");
console.log("本文の長さ:", text.length);
console.log("QRG の出現:", [...new Set([...text.matchAll(/QRG\d{4}/gu)].map(m => m[0]))].join(","));
console.log("--- 本文の抜粋（末尾 2500 字）---");
console.log(text.slice(-2500));
