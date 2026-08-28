// 上書き行を**どこに置けるか**を実機に判定させる。
// 挿入位置を決めるのはこの結果（原典は置き場所を書いていない）。
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
const cnst = (row, col, text) => T(put(put(put(A(), 39, String(row).padStart(3)), 42, String(col).padStart(3)), 45, `'${text}'`));
const condPos = (name, row, col) => T(put(put(put(A(), 9, name), 39, String(row).padStart(3)), 42, String(col).padStart(3)));
// 標識つきの項目（条件が付いていても上書きできるか）。
// 標識は **9-10 桁に 2 桁**。3 桁で書くと `" 1"` になり、上書き行と無関係に落ちる
// （最初にこれで書いて「標識つきは通らない」と誤判定した。対照 Q1 が拾った）。
const fldInd = (ind, n, row, col) => T(put(fld(n, row, col).padEnd(80), 9, String(ind).padStart(2, "0")));
// 継続行（`+`）を持つ項目
const contFld = (n, row, col) => T(put(fld(n, row, col).padEnd(80), 45, "COLOR(RED) +"));

const D = kw("DSPSIZ(24 80 27 132)");
const CASES = [
  { n: "P1", why: "項目のすぐ後ろ（基準）", src: [D, rec("T"), fld("FLDB", 5, 2), condPos("*DS4", 6, 3)] },
  { n: "P2", why: "継続行(+)の後ろ", src: [D, rec("T"), contFld("FLDB", 5, 2), kw("DSPATR(RI)"), condPos("*DS4", 6, 3)] },
  { n: "P3", why: "継続行(+)の**途中**（項目行と継続の間）", src: [D, rec("T"), contFld("FLDB", 5, 2), condPos("*DS4", 6, 3), kw("DSPATR(RI)")] },
  { n: "P4", why: "単独キーワード行の後ろ", src: [D, rec("T"), fld("FLDB", 5, 2), kw("DSPATR(RI)"), condPos("*DS4", 6, 3)] },
  { n: "P5", why: "項目行の**前**", src: [D, rec("T"), condPos("*DS4", 6, 3), fld("FLDB", 5, 2)] },
  { n: "P6", why: "2 項目のあと 1 本（後ろの項目に付く想定）", src: [D, rec("T"), fld("FLDA", 4, 2), fld("FLDB", 5, 2), condPos("*DS4", 6, 3)] },
  { n: "P7", why: "標識つきの項目の後ろ", src: [D, rec("T"), fldInd(1, "FLDB", 5, 2), condPos("*DS4", 6, 3)] },
  { n: "P8", why: "定数の後ろ", src: [D, rec("T"), cnst(5, 2, "HELLO"), condPos("*DS4", 6, 3)] },
  { n: "P9", why: "同じ項目に上書き行 2 本（*DS4 を重ねる）", src: [D, rec("T"), fld("FLDB", 5, 2), condPos("*DS4", 6, 3), condPos("*DS4", 7, 4)] },
  { n: "PA", why: "上書き行が長さ欄を持つ", src: [D, rec("T"), fld("FLDB", 5, 2), T(put(condPos("*DS4", 6, 3).padEnd(80), 30, "   10"))] },
  { n: "PB", why: "様式の直後（項目が無い）", src: [D, rec("T"), condPos("*DS4", 6, 3), kw("OVERLAY"), fld("FLDB", 5, 2)] }
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
