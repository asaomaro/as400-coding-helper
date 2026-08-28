/**
 * batch5 の 2 つの問いを実機に判定させる。
 *
 *  1. `DSPSIZ` に宣言していない画面サイズ条件名で条件付けたら通るか
 *  2. `EDTCDE` は 35 桁目が `Y` のフィールドでも通るか（表示装置・印刷装置とも）
 *
 * 判定は副作用の無い形（コンパイルするだけ。作ったファイルは消す）。
 */
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
const kw = (text, col = 45) => put(A(), col, text).replace(/ +$/u, "");
const rec = name => put(put(A(), 17, "R"), 19, name).replace(/ +$/u, "");
/** 条件付き定数。cond は 7 桁目から。 */
const constAt = (cond, row, col, text) => {
  let l = put(put(put(A(), 39, String(row).padStart(3)), 42, String(col).padStart(3)), 45, text);
  if (cond) l = put(l, 7, cond);
  return l.replace(/ +$/u, "");
};
const field = (shift, dec, usage, row, col, extra) => {
  let l = put(put(put(put(put(A(), 19, "F1"), 30, "    6"), 35, shift), 38, usage), 39, String(row).padStart(3));
  if (dec !== null) l = put(l, 36, String(dec).padStart(2));
  l = put(l, 42, String(col).padStart(3));
  if (extra) l = put(l, 45, extra);
  return l.replace(/ +$/u, "");
};

const CASES = [
  { n: "S1", type: "DSPF", why: "宣言していない条件名 *NOTDECL で条件付け",
    src: [kw("DSPSIZ(24 80 *DS3)"), rec("T"), constAt(" *NOTDECL", 2, 4, "'X'")] },
  { n: "S2", type: "DSPF", why: "DSPSIZ に宣言した *MYSIZE で条件付け",
    src: [kw("DSPSIZ(24 80 *MYSIZE 27 132 *BIG)"), rec("T"), constAt(" *MYSIZE", 2, 4, "'X'")] },
  { n: "S3", type: "DSPF", why: "数値形式の DSPSIZ に IBM 提供名 *DS3 で条件付け",
    src: [kw("DSPSIZ(24 80)"), rec("T"), constAt(" *DS3", 2, 4, "'X'")] },
  { n: "E6", type: "DSPF", why: "表示装置: 6Y 2O に EDTCDE(J)",
    src: [rec("T"), field("Y", 2, "O", 2, 30, "EDTCDE(J)")] },
  { n: "E7", type: "PRTF", why: "印刷装置: 6Y 2O に EDTCDE(J)",
    src: [rec("T"), field("Y", 2, "O", 2, 30, "EDTCDE(J)")] },
  { n: "E8", type: "PRTF", why: "印刷装置: 6S 2O に EDTCDE(J)（比較）",
    src: [rec("T"), field("S", 2, "O", 2, 30, "EDTCDE(J)")] }
];

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const c of CASES) await ifs.writeFile(`${IFS}/${c.n}.dds`, new TextEncoder().encode(c.src.join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }

const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
try {
  for (const c of CASES) {
    const srcType = c.type === "PRTF" ? "PRTF" : "DSPF";
    const create = c.type === "PRTF" ? "CRTPRTF" : "CRTDSPF";
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.n}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QDDSSRCJ.FILE/${c.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QDDSSRCJ) MBR(${c.n}) SRCTYPE(${srcType})`);
    const r = await cmd.run(`${create} FILE(${LIB}/${c.n}) SRCFILE(${LIB}/QDDSSRCJ) SRCMBR(${c.n}) REPLACE(*YES)`);
    console.log(`${r.success ? "通る  " : "通らない"} ${c.n} [${c.type}] ${c.why}`);
    if (!r.success) console.log("        ", r.messages.map(m => `${m.id} ${m.text}`).join(" / ").slice(0, 130));
    if (r.success) await cmd.run(`DLTF FILE(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QDDSSRCJ) MBR(${c.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${c.n}.dds')`);
  }
} finally { cmd.close(); }
