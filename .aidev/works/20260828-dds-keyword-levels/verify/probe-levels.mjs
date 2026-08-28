// **キーワードを違うレベルに書くと実機が通さないこと**を確かめる。
// 検査を既定 ON にしてよいかの裏づけ（真陽性であること）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const hs = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;
const put = (l, c, v) => { const a = l.padEnd(80).split(""); for (let i = 0; i < v.length; i += 1) a[c - 1 + i] = v[i]; return a.join("").replace(/ +$/u, ""); };
const A = () => put(" ".repeat(80), 6, "A");
const kw = t => put(A(), 45, t);
const rec = (n, t) => (t ? put(put(put(A(), 17, "R"), 19, n), 45, t) : put(put(A(), 17, "R"), 19, n));
const fld = (n, col, t) => {
  let l = put(put(put(put(put(A(), 19, n), 30, "   10"), 35, "A"), 38, "B"), 39, "  5");
  l = put(l, 42, String(col).padStart(3));
  return t ? put(l, 45, t) : l;
};

const CASES = [
  { n: "V1", why: "対照（正しいレベル）", src: [kw("DSPSIZ(24 80)"), rec("MAIN", "OVERLAY"), fld("F1", 2, "COLOR(RED)")], expect: true },
  { n: "V2", why: "**DSPSIZ を様式に**（原典: ファイル・レベル）", src: [rec("MAIN", "DSPSIZ(24 80)"), fld("F1", 2)], expect: false },
  { n: "V3", why: "**DSPSIZ を項目に**", src: [rec("MAIN"), fld("F1", 2, "DSPSIZ(24 80)")], expect: false },
  { n: "V4", why: "**OVERLAY をファイル・レベルに**（原典: レコード・レベル）", src: [kw("OVERLAY"), rec("MAIN"), fld("F1", 2)], expect: false },
  { n: "V5", why: "**OVERLAY を項目に**", src: [rec("MAIN"), fld("F1", 2, "OVERLAY")], expect: false },
  { n: "V6", why: "**COLOR を様式に**（原典: フィールド・レベル）", src: [rec("MAIN", "COLOR(RED)"), fld("F1", 2)], expect: false },
  { n: "V7", why: "**COLOR をファイル・レベルに**", src: [kw("COLOR(RED)"), rec("MAIN"), fld("F1", 2)], expect: false }
];

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const c of CASES) await ifs.writeFile(`${IFS}/${c.n}.dds`, new TextEncoder().encode(c.src.join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }
const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
let bad = 0;
try {
  for (const c of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.n}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QDDSSRCJ.FILE/${c.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QDDSSRCJ) MBR(${c.n}) SRCTYPE(DSPF)`);
    const r = await cmd.run(`CRTDSPF FILE(${LIB}/${c.n}) SRCFILE(${LIB}/QDDSSRCJ) SRCMBR(${c.n}) REPLACE(*YES)`);
    const ok = r.success === c.expect;
    if (!ok) bad += 1;
    console.log(`${ok ? "期待どおり" : "**食い違う**"} ${c.n} ${r.success ? "通る" : "通らない"} — ${c.why}`);
    if (r.success) await cmd.run(`DLTF FILE(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QDDSSRCJ) MBR(${c.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${c.n}.dds')`);
  }
} finally { cmd.close(); }
process.exit(bad === 0 ? 0 : 1);
