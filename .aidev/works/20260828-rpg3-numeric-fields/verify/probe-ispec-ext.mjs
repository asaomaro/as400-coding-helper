// 桁は直った。残る 2 件は桁ではない:
//   QRG4118: 外部記述ファイルの I 仕様には**ファイル名ではなくレコード様式名**を書く。
//   QRG7023: 終了する手立てが無い（`IF` ＋ `SETON LR` なし）。
// ここでは前者だけを確かめる（後者は「何を例示するか」の話なので直さない）。
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
const at = (s, ...p) => p.reduce((l, [c, v]) => put(l, c, v), put(" ".repeat(80), 6, s));

const base = iLine => [
  at("F", [7, "CUSTMAS"], [15, "I"], [16, "F"], [19, "E"], [31, "K"], [40, "DISK"]),
  iLine,
  at("C", [28, "SETON"], [54, "LR"])          // 終了できる形にして QRG7023 を外し、I 仕様だけを見る
];
const CASES = [
  { n: "Z1", why: "対照: **レコード様式名** `CUSTREC` ＋ `NS` ＋ 標識 01", src: base(at("I", [7, "CUSTREC"], [15, "NS"], [19, "01"])), expect: true },
  { n: "Z2", why: "レコード様式名だけ（`NS` なし）",                        src: base(at("I", [7, "CUSTREC"], [19, "01"])),               expect: null },
  { n: "Z3", why: "**ファイル名** `CUSTMAS`（いまのサンプルの形）",          src: base(at("I", [7, "CUSTMAS"], [15, "NS"], [19, "01"])),   expect: false }
];

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const x of CASES) await ifs.writeFile(`${IFS}/${x.n}.rpg`, new TextEncoder().encode(x.src.join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }
const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
let bad = 0;
try {
  await cmd.run(`CRTDUPOBJ OBJ(CUSTMAS) FROMLIB(${LIB}) OBJTYPE(*FILE) TOLIB(QGPL)`);
  for (const x of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${x.n}.rpg') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPSRC.FILE/${x.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QTMPSRC) MBR(${x.n}) SRCTYPE(RPG)`);
    const r = await cmd.run(`CRTRPGPGM PGM(${LIB}/${x.n}) SRCFILE(${LIB}/QTMPSRC) SRCMBR(${x.n}) REPLACE(*YES)`);
    const mark = x.expect === null ? "（判定用）" : r.success === x.expect ? "期待どおり" : "**食い違う**";
    if (x.expect !== null && r.success !== x.expect) bad += 1;
    console.log(`${mark} ${x.n} ${r.success ? "通る  " : "通らない"} — ${x.why}`);
    if (r.success) await cmd.run(`DLTPGM PGM(${LIB}/${x.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QTMPSRC) MBR(${x.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${x.n}.rpg')`);
  }
} finally { await cmd.run(`DLTF FILE(QGPL/CUSTMAS)`); cmd.close(); }
console.log(`\n食い違い ${bad} 件`);
process.exit(bad === 0 ? 0 : 1);
