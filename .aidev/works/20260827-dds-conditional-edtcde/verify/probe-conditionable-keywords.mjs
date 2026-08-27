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
const fld = (usage, kwSame) => {
  let l = put(put(put(put(put(put(A(), 19, "F1"), 30, "    6"), 35, "Y"), 36, " 2"), 38, usage), 39, "  2");
  l = put(l, 42, " 30");
  if (kwSame) l = put(l, 45, kwSame);
  return l.replace(/ +$/u, "");
};
const kwLine = (cond, kw) => {
  let l = put(A(), 45, kw);
  if (cond) l = put(l, 7, cond);
  return l.replace(/ +$/u, "");
};
const rec = put(put(A(), 17, "R"), 19, "EDTR").replace(/ +$/u, "");

const constLine = (cond, kw) => {
  let l = put(put(put(A(), 39, "  4"), 42, " 10"), 45, kw);
  if (cond) l = put(l, 7, cond);
  return l.replace(/ +$/u, "");
};

const CASES = [
  { n: "K1", why: "EDTCDE を 50 で条件付け（B）",     src: [rec, fld("B"), kwLine("  50", "EDTCDE(J)")] },
  { n: "K2", why: "EDTCDE を 50 で条件付け（O）",     src: [rec, fld("O"), kwLine("  50", "EDTCDE(J)")] },
  { n: "K3", why: "DSPATR を 50 で条件付け",          src: [rec, fld("B"), kwLine("  50", "DSPATR(RI)")] },
  { n: "K4", why: "COLOR を 50 で条件付け",           src: [rec, fld("O"), kwLine("  50", "COLOR(RED)")] },
  { n: "K5", why: "定数に DSPATR を 50 で条件付け",   src: [rec, constLine(null, "'X'"), kwLine("  50", "DSPATR(HI)")] },
  { n: "K6", why: "EDTWRD を 50 で条件付け（O）",     src: [rec, fld("O"), kwLine("  50", "EDTWRD('  0.  ')")] },
  { n: "K7", why: "CHECK を 50 で条件付け（B）",      src: [rec, fld("B"), kwLine("  50", "CHECK(RB)")] }
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
    if (!r.success) console.log("        ", r.messages.map(m => `${m.id} ${m.text}`).join(" / ").slice(0, 150));
    if (r.success) await cmd.run(`DLTF FILE(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QDDSSRCJ) MBR(${c.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${c.n}.dds')`);
  }
} finally { cmd.close(); }
