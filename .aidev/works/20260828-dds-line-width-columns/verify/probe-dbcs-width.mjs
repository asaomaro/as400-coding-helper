// キーワード欄（45-80 桁 = 36 桁）に DBCS がいくつ入るかを実機に測らせる。
// `'` + SO + 2n + SI + `'` <= 36 なら n <= 16 のはず。
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
const rec = n => T(put(put(A(), 17, "R"), 19, n));
const dbcs = n => T(put(put(put(A(), 39, "  5"), 42, "  2"), 45, `'${"顧".repeat(n)}'`));
const mixed = (sb, db) =>
  T(put(put(put(A(), 39, "  5"), 42, "  2"), 45, `'${"X".repeat(sb)}${"顧".repeat(db)}'`));

const CASES = [
  { n: "W5", why: "全角 15（'+SO+30+SI+' = 34 桁）", src: [rec("MAIN"), dbcs(15)] },
  { n: "W6", why: "**全角 16（= 36 桁ちょうど）**", src: [rec("MAIN"), dbcs(16)] },
  { n: "W7", why: "**全角 17（= 38 桁・はみ出す）**", src: [rec("MAIN"), dbcs(17)] },
  { n: "W8", why: "半角 2 ＋ 全角 15（'+2+SO+30+SI+' = 36 桁ちょうど）", src: [rec("MAIN"), mixed(2, 15)] },
  { n: "W9", why: "半角 3 ＋ 全角 15（= 37 桁・はみ出す）", src: [rec("MAIN"), mixed(3, 15)] }
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
