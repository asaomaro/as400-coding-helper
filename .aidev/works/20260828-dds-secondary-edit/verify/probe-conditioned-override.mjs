// P7（標識つきの項目に上書き行が付かない）を切り分ける。
// 標識そのものが原因か、書き方の問題かを分ける。
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
// 標識は **9-10 桁に 2 桁**（`01`）。3 桁で書くと `" 1"` になり、上書き行と無関係に落ちる。
const withInd = (line, ind) => T(put(line.padEnd(80), 9, String(ind).padStart(2, "0")));
const condPos = (name, row, col) => T(put(put(put(A(), 9, name), 39, String(row).padStart(3)), 42, String(col).padStart(3)));
const condOnly = ind => T(put(A(), 9, String(ind).padStart(2, "0")));

const D = kw("DSPSIZ(24 80 27 132)");
const CASES = [
  { n: "Q1", why: "標識つき項目（上書き行なし）＝ 対照", src: [D, rec("T"), withInd(fld("FLDB", 5, 2), 1)] },
  { n: "Q2", why: "標識つき項目 ＋ 上書き行（P7 の再現）", src: [D, rec("T"), withInd(fld("FLDB", 5, 2), 1), condPos("*DS4", 6, 3)] },
  { n: "Q3", why: "標識つき項目 ＋ 上書き行にも同じ標識", src: [D, rec("T"), withInd(fld("FLDB", 5, 2), 1), withInd(condPos("*DS4", 6, 3), 1)] },
  { n: "Q4", why: "OR 前置きで条件付けた項目 ＋ 上書き行", src: [D, rec("T"), condOnly(1), withInd(fld("FLDB", 5, 2), 2), condPos("*DS4", 6, 3)] },
  { n: "Q5", why: "標識つき定数 ＋ 上書き行", src: [D, rec("T"), withInd(T(put(put(put(A(), 39, "  5"), 42, "  2"), 45, "'X'")), 1), condPos("*DS4", 6, 3)] },
  { n: "Q6", why: "無条件の項目 ＋ 上書き行（対照・通るはず）", src: [D, rec("T"), fld("FLDB", 5, 2), condPos("*DS4", 6, 3)] },
  { n: "Q7", why: "標識つき項目 ＋ 上書き行が **N01**（画面サイズ名でなく標識）", src: [D, rec("T"), withInd(fld("FLDB", 5, 2), 1), T(put(put(put(put(A(), 8, "N"), 9, "01"), 39, "  6"), 42, "  3"))] }
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
