// 「QRG2023 でない ＝ 語は有効」と読んでよいかを、**メッセージ本文で裏取りする**。
// 4 語が QRG2156 で揃ったので、それが「語が違う」なのか「この装置では使えない」なのかで
// 結論が変わる。リスト末尾の MESSAGE SUMMARY を読む。
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const TS5250 = "/workspaces/ts5250";
const { CommandConnection, IfsConnection, DbConnection, query, NetPrintConnection } =
  await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;
const put = (l, c, v) => { const a = l.padEnd(80).split(""); for (let i = 0; i < v.length; i += 1) a[c - 1 + i] = v[i]; return a.join("").replace(/ +$/u, ""); };
const at = (s, ...p) => p.reduce((l, [c, v]) => put(l, c, v), put(" ".repeat(80), 6, s));
const fIn  = () => at("F", [7, "INFILE"], [15, "I"], [16, "P"], [19, "F"], [24, "  80"], [40, "DISK"]);
const iRec = () => at("I", [7, "INFILE"], [15, "NS"], [19, "01"]);
const iFld = () => at("I", [44, "   1"], [48, "  10"], [53, "NAME"]);
const iDs  = () => [at("I", [7, "FDS"], [19, "DS"]), at("I", [44, "   1"], [48, "  80"], [53, "FDUMMY"])];
const END  = at("C", [28, "SETON"], [54, "LR"]);
const cont = (opt, entry) => at("F", [53, "K"], [54, opt], [60, entry]);
const CASES = [
  { n: "M01", opt: "SAVDS" },   // QRG2156
  { n: "M02", opt: "ZZZZZZ" },  // QRG2023（対照）
  { n: "M03", opt: "IGNORE" },  // QRG2068 ほか
  { n: "M04", opt: "SFILE" }    // QRG2107
];
const src = opt => [fIn(), cont(opt, "FDS"), iRec(), iFld(), ...iDs(), END].join("\n") + "\n";

const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const c of CASES) await ifs.writeFile(`${IFS}/${c.n}.rpg`, new TextEncoder().encode(src(c.opt)), { create: true, truncate: true }); }
finally { ifs.close(); }
const db = await DbConnection.connect({ ...creds, resolvePort: true });
const printer = await NetPrintConnection.connect({ ...creds, resolvePort: true });
const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPSRC) RCDLEN(112)`);
  for (const c of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.n}.rpg') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPSRC.FILE/${c.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QTMPSRC) MBR(${c.n}) SRCTYPE(RPG)`);
    const r = await cmd.run(`CRTRPGPGM PGM(${LIB}/${c.n}) SRCFILE(${LIB}/QTMPSRC) SRCMBR(${c.n}) REPLACE(*YES) GENLVL(50)`);
    const q = await query(db, `SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
      WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME = '${c.n}' ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 1 ROWS ONLY`);
    const sp = q.rows[0];
    const [jobNumber, jobUser, jobName] = String(sp.JOB_NAME).split("/");
    const pages = await printer.readSpooledPages({ fileName: sp.SPOOLED_FILE_NAME, fileNumber: sp.FILE_NUMBER, jobName, jobUser, jobNumber });
    const lines = pages.flatMap(p => (p.lines ?? p.rows ?? []).map(l => (typeof l === "string" ? l : l.text ?? "")));
    console.log(`\n=== ${c.n} ${c.opt} (作成=${r.success ? "○" : "×"}) ===`);
    // MESSAGE SUMMARY 以降で QRG を含む行と、その次行（本文の続き）を出す。
    const start = lines.findIndex(l => /MESSAGE\s+SUMMARY/iu.test(l));
    const tail = start >= 0 ? lines.slice(start) : lines;
    tail.forEach((l, i) => { if (/QRG\d{4}/u.test(l)) console.log("  " + l.trim().slice(0, 150) + (tail[i+1]?.trim() ? " / " + tail[i+1].trim().slice(0, 110) : "")); });
    if (r.success) await cmd.run(`DLTPGM PGM(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QTMPSRC) MBR(${c.n})`);
    await cmd.run(`DLTSPLF FILE(${c.n}) JOB(${sp.JOB_NAME}) SPLNBR(*LAST)`).catch(() => {});
  }
  await cmd.run(`DLTF FILE(${LIB}/QTMPSRC)`);
} finally {
  cmd.close(); db.close(); printer.close();
  const clean = await IfsConnection.connect({ ...creds, resolvePort: true });
  try { for (const c of CASES) await clean.deleteFile(`${IFS}/${c.n}.rpg`).catch(() => {}); } finally { clean.close(); }
}
