// `＋` から足したキーワードの形が実機で通るかを見る。
//
// 論点は 2 つ。**総称（CFnn）をそのまま書いた形**と、
// **引数が任意のキーワードに空の括弧を付けた形**。
//
// 結果（IBM i 7.3）:
//   - CF03 / CF03() / CF03(03) / CA24 は通る
//   - CFNN / CFNN()（いまの ＋ が書く形）/ CF00 / CF25 は通らない
//   - PRINT() / OVERLAY() / CLEAR() は通る＝空の括弧は誤りではない
//   - SFLEND() は通らないが、**対照（SFLEND を括弧なしで書いた形）も通らない**。
//     素のサブファイルは通るので、原因は括弧ではなく SFLEND の前提条件。
//     括弧の是非はこの件では判定できない（別項目に回した）。
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
const body = [rec("MAIN"), fld("FLDA", 5, 2)];
// ファイル・レベルに置くもの / 様式に置くもの を分ける。
const atFile = t => [kw(t), ...body];
const atRecord = t => [T(put(put(put(A(), 17, "R"), 19, "MAIN"), 45, t)), fld("FLDA", 5, 2)];

const CASES = [
  { n: "O1", why: "CF03（括弧なし）", src: atFile("CF03") },
  { n: "O2", why: "**CF03()（空の括弧）**", src: atFile("CF03()") },
  { n: "O3", why: "CF03(03)", src: atFile("CF03(03)") },
  { n: "O4", why: "CF03(03 'exit')", src: atFile("CF03(03 'exit')") },
  { n: "O5", why: "CF25（原典の範囲外）", src: atFile("CF25") },
  { n: "O6", why: "CFNN（総称のまま）", src: atFile("CFNN") },
  { n: "O7", why: "CFNN()（いまの ＋ が書く形）", src: atFile("CFNN()") },
  { n: "O8", why: "CF00（番号 0）", src: atFile("CF00") },
  { n: "O9", why: "CA24（範囲の上端）", src: atFile("CA24") },
  { n: "OA", why: "PRINT（括弧なし・実サンプルの形）", src: atFile("PRINT") },
  { n: "OB", why: "**PRINT()（空の括弧）**", src: atFile("PRINT()") },
  { n: "OC", why: "OVERLAY（様式・引数なし）", src: atRecord("OVERLAY") },
  { n: "OD", why: "**OVERLAY()（空の括弧）**", src: atRecord("OVERLAY()") },
  { n: "OE", why: "**SFLEND()（空の括弧・引数は任意）**", src: atRecord("SFLEND()") },
  { n: "OF", why: "CLEAR()（空の括弧・引数は任意）", src: atFile("CLEAR()") }
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
