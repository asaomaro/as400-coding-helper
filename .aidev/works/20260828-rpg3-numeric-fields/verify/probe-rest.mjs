// **残りの欄。** 1・2 回目で触れていないものを閉じる:
//   E 仕様のエントリ長2（52-54。交替テーブルが要る）/ L 仕様の最後の行番号（70-72）/
//   スペース欄の下限 `0` / 53 桁目が継続の `K` を受けること。
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
const fPrint = (x = []) => at("F", [7, "PRINT"], [15, "O"], [19, "F"], [24, " 132"], [33, "OF"], [40, "PRINTER"], ...x);
const iRec   = () => at("I", [7, "INFILE"], [15, "NS"], [19, "01"]);
const iFld   = () => at("I", [44, "   1"], [48, "  10"], [53, "NAME"]);
const END    = at("C", [28, "SETON"], [54, "LR"]);
const oRec   = (x = []) => at("O", [7, "PRINT"], [15, "D"], [18, "1"], ...x);
const oFld   = () => at("O", [32, "NAME"], [40, "  30"]);
const useTab = at("C", [28, "MOVE "], [33, "TAB1"], [43, "FLDA"], [49, "  3"]);
const useTb2 = at("C", [28, "MOVE "], [33, "TAB2"], [43, "FLDB"], [49, "  2"]);
// 交替テーブル: 名前2 46-51 / 長さ2 52-54
const eAlt   = (x = []) => at("E", [27, "TAB1"], [33, "  1"], [36, "   3"], [40, "  3"], [46, "TAB2"], [52, "  2"], ...x);
const lLine  = (x = []) => at("L", [7, "PRINT"], [15, " 66"], [18, "FL"], [20, " 60"], [23, "OL"], ...x);

const e = x => [fIn(), eAlt(x), iRec(), iFld(), useTab, useTb2, END, "**", "AAABB", "BBBCC", "CCCDD"];
const l = x => [fIn(), fPrint([[39, "L"]]), lLine(x), iRec(), iFld(), END, oRec(), oFld()];
const o = x => [fIn(), fPrint(), iRec(), iFld(), END, oRec(x), oFld()];
const f = x => [fIn(x), iRec(), iFld(), END];

const CASES = [
  { n: "R1", why: "対照: 交替テーブル（長さ2 52-54 に `  2`）",              src: e(),               expect: true },
  { n: "R2", why: "エントリ長2 52-54 に**英字** `  A`",                      src: e([[52, "  A"]]),  expect: false },
  { n: "R3", why: "エントリ長2 52-54 を**左詰め** `2  `",                    src: e([[52, "2  "]]),  expect: false },
  { n: "R4", why: "対照: L 仕様の 12 本目の行番号 70-72 に ` 55`",            src: l([[70, " 55"], [73, "CH"]]), expect: true },
  { n: "R5", why: "12 本目の行番号 70-72 に**英字** ` 5A`",                   src: l([[70, " 5A"], [73, "CH"]]), expect: false },
  { n: "R6", why: "スペース前 `0`（下限）",                                   src: o([[17, "0"]]),    expect: null },
  { n: "R7", why: "F 53 桁目に継続の `K`（実機はここを継続欄と言う）",        src: f([[53, "K"]]),    expect: null }
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
