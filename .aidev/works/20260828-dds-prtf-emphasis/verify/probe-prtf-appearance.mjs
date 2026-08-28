// 帳票の見え方のキーワードを実機に判定させる。
// 論点は 2 つ: **使用レベル**（UNDERLINE は様式に書けるか）と
// **色の名前の集合**（画面と違うか）。
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
const recKw = (n, t) => T(put(put(put(A(), 17, "R"), 19, n), 45, t));
const rec = n => T(put(put(A(), 17, "R"), 19, n));
// 帳票の項目: 位置欄は桁だけ（行は行送りで決まる）。
const fld = (n, col, t) =>
  T(put(put(put(put(put(A(), 19, n), 30, "   10"), 35, "A"), 42, String(col).padStart(3)), 45, t ?? ""));

const CASES = [
  { n: "P1", why: "対照（キーワードなし）", src: [rec("DETAIL"), fld("F1", 5)] },
  { n: "P2", why: "HIGHLIGHT を**様式**に", src: [recKw("DETAIL", "HIGHLIGHT"), fld("F1", 5)] },
  { n: "P3", why: "HIGHLIGHT を**項目**に", src: [rec("DETAIL"), fld("F1", 5, "HIGHLIGHT")] },
  { n: "P4", why: "**UNDERLINE を様式に**（原典は項目レベルのみ）", src: [recKw("DETAIL", "UNDERLINE"), fld("F1", 5)] },
  { n: "P5", why: "UNDERLINE を項目に", src: [rec("DETAIL"), fld("F1", 5, "UNDERLINE")] },
  { n: "P6", why: "COLOR(BLK)（帳票にある名前）", src: [rec("DETAIL"), fld("F1", 5, "COLOR(BLK)")] },
  { n: "P7", why: "COLOR(BRN)（帳票にある名前）", src: [rec("DETAIL"), fld("F1", 5, "COLOR(BRN)")] },
  { n: "P8", why: "**COLOR(WHT)**（画面にはあるが帳票の一覧に無い）", src: [rec("DETAIL"), fld("F1", 5, "COLOR(WHT)")] },
  { n: "P9", why: "COLOR(*RGB 0 0 0)", src: [rec("DETAIL"), fld("F1", 5, "COLOR(*RGB 0 0 0)")] },
  { n: "PA", why: "**COLOR を様式に**（原典は項目レベルのみ）", src: [recKw("DETAIL", "COLOR(RED)"), fld("F1", 5)] },
  { n: "PB", why: "HIGHLIGHT ＋ UNDERLINE ＋ COLOR を項目に", src: [rec("DETAIL"), fld("F1", 5, "HIGHLIGHT UNDERLINE COLOR(RED)")] },
  { n: "PC", why: "**DSPATR(HI) を帳票に**（画面のキーワード）", src: [rec("DETAIL"), fld("F1", 5, "DSPATR(HI)")] }
];

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const c of CASES) await ifs.writeFile(`${IFS}/${c.n}.prtf`, new TextEncoder().encode(c.src.join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }
const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
try {
  for (const c of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.n}.prtf') TOMBR('/QSYS.LIB/${LIB}.LIB/QDDSSRCJ.FILE/${c.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QDDSSRCJ) MBR(${c.n}) SRCTYPE(PRTF)`);
    const r = await cmd.run(`CRTPRTF FILE(${LIB}/${c.n}) SRCFILE(${LIB}/QDDSSRCJ) SRCMBR(${c.n}) REPLACE(*YES)`);
    console.log(`${r.success ? "通る  " : "通らない"} ${c.n} ${c.why}`);
    if (r.success) await cmd.run(`DLTF FILE(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QDDSSRCJ) MBR(${c.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${c.n}.prtf')`);
  }
} finally { cmd.close(); }
