// L 仕様は何組まで使えるか。実機は QRG3049 で「25-74 桁は空白」と言う＝**2 組まで**のはず。
// 消去法にしないため、3 組目を直接置いて確かめる（対照は 2 組で通る形）。
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
const fIn    = () => at("F", [7, "INFILE"], [15, "I"], [16, "P"], [19, "F"], [24, "  80"], [40, "DISK"]);
const fPrint = () => at("F", [7, "PRINT"], [15, "O"], [19, "F"], [24, " 132"], [33, "OF"], [39, "L"], [40, "PRINTER"]);
const iRec   = () => at("I", [7, "INFILE"], [15, "NS"], [19, "01"]);
const iFld   = () => at("I", [44, "   1"], [48, "  10"], [53, "NAME"]);
const END    = at("C", [28, "SETON"], [54, "LR"]);
const oRec   = () => at("O", [7, "PRINT"], [15, "D"], [18, "1"]);
const oFld   = () => at("O", [32, "NAME"], [40, "  30"]);
const l = x => [fIn(), fPrint(), at("L", [7, "PRINT"], [15, " 66"], [18, "FL"], [20, " 60"], [23, "OL"], ...x),
                iRec(), iFld(), END, oRec(), oFld()];
const CASES = [
  { n: "X1", why: "対照: **2 組**（行/チャネル 15-24 だけ）",                    src: l([]),                          expect: true },
  { n: "X2", why: "**3 組目**を 25-27 / 28-29 に置く（25 桁目から先は使えるか）", src: l([[25, " 50"], [28, "02"]]),   expect: false },
  { n: "X3", why: "25 桁目に 1 文字だけ置く（境目そのもの）",                    src: l([[25, "5"]]),                 expect: false },
  { n: "X4", why: "24 桁目まで（対照と同じ範囲）でチャネルを番号 `02` にする",    src: [fIn(), fPrint(),
      at("L", [7, "PRINT"], [15, " 66"], [18, "FL"], [20, " 60"], [23, "02"]), iRec(), iFld(), END, oRec(), oFld()], expect: null }
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
