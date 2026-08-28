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
const T = l => l.replace(/ +$/u, "");
const kw = t => T(put(A(), 45, t));
const rec = n => T(put(put(A(), 17, "R"), 19, n));
const fld = (n, row, col) => T(put(put(put(put(put(put(A(), 19, n), 30, "   10"), 35, "A"), 38, "B"), 39, String(row).padStart(3)), 42, String(col).padStart(3)));
const cond = (name, rest) => { let l = put(A(), 9, name); if (rest) l = put(l, 45, rest); return T(l); };
const condPos = (name, row, col) => T(put(put(put(A(), 9, name), 39, String(row).padStart(3)), 42, String(col).padStart(3)));
const condConst = (name, row, col) => T(put(put(put(put(A(), 9, name), 39, String(row).padStart(3)), 42, String(col).padStart(3)), 45, "'X'"));

const D = kw("DSPSIZ(24 80 27 132)");
const CASES = [
  { n: "G1", why: "キーワード行 DSPATR(RI) を *DS4 で条件付け", src: [D, rec("T"), fld("FLDB", 5, 2), cond("*DS4", "DSPATR(RI)")] },
  { n: "G2", why: "キーワード行 COLOR(RED) を *DS4 で条件付け", src: [D, rec("T"), fld("FLDB", 5, 2), cond("*DS4", "COLOR(RED)")] },
  { n: "G3", why: "キーワード行 OVERLAY を *DS4 で条件付け", src: [D, rec("T"), cond("*DS4", "OVERLAY"), fld("FLDB", 5, 2)] },
  { n: "G4", why: "上書き行のあとにキーワード行（比較・条件なし）", src: [D, rec("T"), fld("FLDB", 5, 2), condPos("*DS4", 6, 3), kw("DSPATR(RI)")] }
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
