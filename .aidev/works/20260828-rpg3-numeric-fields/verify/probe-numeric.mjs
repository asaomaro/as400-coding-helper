// **RPG III の数値欄を実機に判定させる。** 欄ごとに 3 つ流す:
//   対照(正しい右寄せの数字) / 英字 / 左詰め。
// 対照が落ちたらその欄の土台が誤っており、他の 2 件の結果は読めない（前 work の教訓）。
//
// 土台は Phase A（probe-base.mjs）で通ることを確かめた形だけを使う:
//   A1 入力 DISK / A2 索引つき入力 / A3 印刷 ＋ O 仕様 / A4 E 仕様 / A5 L 仕様
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

// ---- 土台（Phase A で通ることを確認済み）----
const fIn    = (x = []) => at("F", [7, "INFILE"], [15, "I"], [16, "P"], [19, "F"], [24, "  80"], [40, "DISK"], ...x);
const fKeyed = (x = []) => at("F", [7, "IXFILE"], [15, "I"], [16, "P"], [19, "F"], [24, "  80"], [29, " 5"], [31, "A"], [32, "I"], [35, "   1"], [40, "DISK"], ...x);
const fPrint = (x = []) => at("F", [7, "PRINT"], [15, "O"], [19, "F"], [24, " 132"], [33, "OF"], [40, "PRINTER"], ...x);
const iRec   = (f = "INFILE") => at("I", [7, f], [15, "NS"], [19, "01"]);
const iFld   = () => at("I", [44, "   1"], [48, "  10"], [53, "NAME"]);
const END    = at("C", [28, "SETON"], [54, "LR"]);
const useTab = at("C", [28, "MOVE "], [33, "TAB1"], [43, "FLDA"], [49, "  3"]);
const eTab   = (x = []) => at("E", [27, "TAB1"], [33, "  1"], [36, "   3"], [40, "  3"], ...x);
const oRec   = (x = []) => at("O", [7, "PRINT"], [15, "D"], [18, "1"], ...x);
const oFld   = (x = []) => at("O", [32, "NAME"], [40, "  30"], ...x);
const lLine  = (x = []) => at("L", [7, "PRINT"], [15, " 66"], [18, "FL"], [20, " 60"], [23, "OL"], ...x);

// 土台ごとのソース組み立て。`x` はその仕様の行に足す上書き。
const BASE = {
  f:  x => [fIn(x), iRec(), iFld(), END],
  fk: x => [fKeyed(x), iRec("IXFILE"), iFld(), END],
  o:  (x, which) => [fIn(), fPrint(), iRec(), iFld(), END,
                     which === "rec" ? oRec(x) : oRec(), which === "fld" ? oFld(x) : oFld()],
  e:  x => [fIn(), eTab(x), iRec(), iFld(), useTab, END, "**", "AAA", "BBB", "CCC"],
  l:  x => [fIn(), fPrint([[39, "L"]]), lLine(x), iRec(), iFld(), END, oRec(), oFld()]
};

/** 欄ひとつにつき 対照 / 英字 / 左詰め の 3 件を作る */
const field = (id, spec, name, col, good, alpha, left, which) => [
  { n: `${id}C`, why: `対照 ${name} ${col} 桁に \`${good}\``,  src: BASE[spec]([[col, good]], which), expect: true },
  { n: `${id}A`, why: `${name} に**英字** \`${alpha}\``,        src: BASE[spec]([[col, alpha]], which), expect: false },
  ...(left ? [{ n: `${id}L`, why: `${name} を**左詰め** \`${left}\``, src: BASE[spec]([[col, left]], which), expect: false }] : [])
];

const CASES = [
  // --- F 仕様 ---
  ...field("BL", "f",  "ブロック長 20-23",           20, "  80", "  8A", "80  "),
  ...field("RA", "fk", "レコードアドレス長 29-30",   29, " 5",   " A",   "5 "),
  ...field("KS", "fk", "キー開始位置 35-38",         35, "   1", "   A", "1   "),
  // --- O 仕様 ---
  ...field("SB", "o",  "スペース前 17",              17, "1",    "A",    null, "rec"),
  ...field("SA", "o",  "スペース後 18",              18, "1",    "A",    null, "rec"),
  ...field("KB", "o",  "スキップ前 19-20",           19, " 1",   " Z",   "1 ",  "rec"),
  ...field("KA", "o",  "スキップ後 21-22",           21, " 1",   " Z",   "1 ",  "rec"),
  ...field("EP", "o",  "終了位置 40-43",             40, "  30", "  3A", "30  ", "fld"),
  // --- E 仕様 ---
  ...field("ER", "e",  "レコードあたり 33-35",       33, "  1",  "  A",  "1  "),
  ...field("ET", "e",  "テーブルあたり 36-39",       36, "   3", "   A", "3   "),
  ...field("EL", "e",  "エントリ長 40-42",           40, "  3",  "  A",  "3  "),
  // --- L 仕様 ---
  ...field("LN", "l",  "行番号 15-17",               15, " 66",  " 6A",  "66 "),
  // --- スキップ欄の英数字形式（100 行以上を表す `A0`〜`C2` を実機が受けるか）---
  { n: "KBX", why: "スキップ前に **`A0`**（原典が言う 100 行目の表記。受けるなら数字だけではない）",
    src: BASE.o([[19, "A0"]], "rec"), expect: null }
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
    console.log(`${mark} ${x.n.padEnd(4)} ${r.success ? "通る  " : "通らない"} — ${x.why}`);
    if (r.success) await cmd.run(`DLTPGM PGM(${LIB}/${x.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QTMPSRC) MBR(${x.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${x.n}.rpg')`);
  }
  await cmd.run(`DLTF FILE(${LIB}/QTMPSRC)`);
} finally { cmd.close(); }
console.log(`\n食い違い ${bad} 件`);
process.exit(bad === 0 ? 0 : 1);
