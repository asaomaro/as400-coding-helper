import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const hs = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;
const put = (l, c, v) => { const a = l.split(""); for (let i = 0; i < v.length; i += 1) a[c - 1 + i] = v[i]; return a.join(""); };
const A = () => put(" ".repeat(80), 6, "A");
const kw = t => put(A(), 45, t).replace(/ +$/u, "");
const rec = n => put(put(A(), 17, "R"), 19, n).replace(/ +$/u, "");
const fld = (name, row, col) => put(put(put(put(put(A(), 19, name), 30, "   10"), 35, "A"), 38, "O"), 39, String(row).padStart(3)).replace(/ +$/u,"");
const fldAt = (name, row, col) => put(put(put(put(put(put(A(), 19, name), 30, "   10"), 35, "A"), 38, "O"), 39, String(row).padStart(3)), 42, String(col).padStart(3)).replace(/ +$/u, "");
/** 位置だけの上書き行（条件名 + 行桁。名前もキーワードも無い）。 */
const override = (nameCol, cond, row, col) =>
  put(put(put(put(A(), nameCol, cond), 39, String(row).padStart(3)), 42, String(col).padStart(3)), 1, "     ").replace(/ +$/u, "").replace(/^ {5}/,"     ");

const mk = (nameCol, cond) => [
  kw("DSPSIZ(27 132 *WIDE 24 80 *NORMAL)"),
  rec("T"),
  fldAt("FIELDB", 1, 81),
  put(put(put(put(A(), nameCol, cond), 39, "  1"), 42, " 50"), 6, "A").replace(/ +$/u, "")
];

const CASES = [
  { n: "O7", why: "上書き行・条件名を 7 桁目から", src: mk(7, "*NORMAL") },
  { n: "O8", why: "上書き行・条件名を 8 桁目から", src: mk(8, "*NORMAL") },
  { n: "O9", why: "上書き行・条件名を 9 桁目から（原典の例）", src: mk(9, "*NORMAL") },
  { n: "O9D", why: "上書き行・*DS3 を 9 桁目から（数値 DSPSIZ）",
    src: [kw("DSPSIZ(24 80 27 132)"), rec("T"), fldAt("FIELDB", 23, 2),
          put(put(put(put(A(), 9, "*DS4"), 39, " 26"), 42, "  2"), 6, "A").replace(/ +$/u, "")] },
  { n: "O9X", why: "上書き行・宣言していない *NOTDECL を 9 桁目から",
    src: mk(9, "*NOTDEC") }
];

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const c of CASES) await ifs.writeFile(`${IFS}/${c.n}.dds`, new TextEncoder().encode(c.src.join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }
const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
try {
  for (const c of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.n}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QDDSSRCJ.FILE/${c.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QDDSSRCJ) MBR(${c.n}) SRCTYPE(DSPF)`);
    const r = await cmd.run(`CRTDSPF FILE(${LIB}/${c.n}) SRCFILE(${LIB}/QDDSSRCJ) SRCMBR(${c.n}) REPLACE(*YES)`);
    console.log(`${r.success ? "通る  " : "通らない"} ${c.n} ${c.why}`);
    if (r.success) await cmd.run(`DLTF FILE(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QDDSSRCJ) MBR(${c.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${c.n}.dds')`);
  }
} finally { cmd.close(); }
