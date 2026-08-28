// **追試。** 1 回目で 2 つ宿題が出た:
//   (1) F 仕様 20-23 の対照が落ちた → 実機は QRG2016 で「20-23 / 47-52 / 60-65 / 67-70 / 73-74 は
//       空白でなければならない」と言う。どこまでがそうなのかを確かめる。
//   (2) スキップ前に `A0` が通った → この欄は数字だけではない。受ける集合の境目を測る。
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

const fIn    = (x = []) => at("F", [7, "INFILE"], [15, "I"], [16, "P"], [19, "F"], [24, "  80"], [40, "DISK"], ...x);
const fPrint = () => at("F", [7, "PRINT"], [15, "O"], [19, "F"], [24, " 132"], [33, "OF"], [40, "PRINTER"]);
const iRec   = () => at("I", [7, "INFILE"], [15, "NS"], [19, "01"]);
const iFld   = () => at("I", [44, "   1"], [48, "  10"], [53, "NAME"]);
const END    = at("C", [28, "SETON"], [54, "LR"]);
const oRec   = (x = []) => at("O", [7, "PRINT"], [15, "D"], [18, "1"], ...x);
const oFld   = () => at("O", [32, "NAME"], [40, "  30"]);

const f  = x => [fIn(x), iRec(), iFld(), END];
const o  = x => [fIn(), fPrint(), iRec(), iFld(), END, oRec(x), oFld()];

const CASES = [
  // (1) F 仕様の「空白でなければならない」桁
  { n: "Q1", why: "F 47-52（シンボリック装置）に値 — QRG2016 が挙げる桁", src: f([[47, "TAPE01"]]), expect: false },
  { n: "Q2", why: "F 71-72（ファイル条件）に `U1` — QRG2016 が**挙げていない**桁", src: f([[71, "U1"]]), expect: true },
  { n: "Q3", why: "F 66（ファイル追加）に `A` — QRG2016 が**挙げていない**桁", src: f([[66, "A"]]), expect: true },
  { n: "Q4", why: "F 53（ラベル）に `E` — QRG2016 が**挙げていない**桁", src: f([[53, "E"]]), expect: true },
  // (2) スキップ欄が受ける集合
  { n: "Q5", why: "スキップ前 `C2`（原典が言う上限 122 行）", src: o([[19, "C2"]]), expect: null },
  { n: "Q6", why: "スキップ前 `D0`（`C2` の先。ここが落ちるなら A0-C2 で閉じている）", src: o([[19, "D0"]]), expect: null },
  { n: "Q7", why: "スキップ**後** `A0`（前と同じ扱いか）", src: o([[21, "A0"]]), expect: null },
  { n: "Q8", why: "スキップ前 `A0` を**左詰めにできない**ことの確認（`0A`）", src: o([[19, "0A"]]), expect: null },
  // (3) スペース欄が数字のどこまでを受けるか
  { n: "Q9", why: "スペース前 `3`（原典の上限）", src: o([[17, "3"]]), expect: null },
  { n: "QA", why: "スペース前 `4`（上限の先。落ちるなら 0-3 の限定値）", src: o([[17, "4"]]), expect: null }
];

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const x of CASES) await ifs.writeFile(`${IFS}/${x.n}.rpg`, new TextEncoder().encode(x.src.join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }
const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
let bad = 0;
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPSRC) RCDLEN(112)`);
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
  await cmd.run(`DLTF FILE(${LIB}/QTMPSRC)`);
} finally { cmd.close(); }
console.log(`\n食い違い ${bad} 件`);
process.exit(bad === 0 ? 0 : 1);
