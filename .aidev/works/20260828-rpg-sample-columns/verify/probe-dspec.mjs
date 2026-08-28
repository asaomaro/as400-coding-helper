// **D 仕様書の長さ欄の桁**を実機に判定させる。
// lint は `docs/src/EMPMNT01.rpgle` の D 仕様に 12 件・`SLSENT01.rpgle` に 18 件を
// 検出している。真陽性なら**サンプルの方が誤り**。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const hs = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;

const put = (l, c, v) => { const a = l.padEnd(100, " ").split(""); for (let i = 0; i < v.length; i += 1) a[c - 1 + i] = v[i]; return a.join("").replace(/ +$/u, ""); };
const spec = s => put(" ".repeat(100), 6, s);
// 原典どおり: 名前 7-21 / 定義の種類 24-25 / 長さ 33-39（右寄せ）/ 型 40 / 小数 41-42
const dsHead = name => put(put(spec("D"), 7, name), 24, "DS");
const sub = (name, len, type, dec) => {
  let l = put(spec("D"), 8, name);
  l = put(l, 40 - String(len).length, String(len));  // 33-39 に右寄せ（末尾が 39）
  l = put(l, 40, type);
  return dec === undefined ? l : put(l, 42, String(dec));
};
// サンプルの形（長さが 1 桁ぶん左）
const subAsSample = (name, len, type, dec) => {
  let l = put(spec("D"), 8, name);
  l = put(l, 32, String(len));
  l = put(l, 33, type);
  return dec === undefined ? l : put(l, 35, String(dec));
};
const cEnd = put(put(spec("C"), 26, "SETON"), 71, "LR");

const CASES = [
  { n: "D1", why: "**原典どおり**（長さ 33-39 / 型 40 / 小数 41-42）",
    src: [dsHead("DATES"), sub("SDATE", 8, "S", 0), sub("SYY", 4, "S", 0), cEnd] },
  { n: "D2", why: "**サンプルの形**（長さ 32 / 型 33 / 小数 35）",
    src: [dsHead("DATES"), subAsSample("SDATE", 8, "S", 0), subAsSample("SYY", 4, "S", 0), cEnd] },
  { n: "D3", why: "サンプルの実物 2 行をそのまま",
    src: [dsHead("DATES"),
          "     D  SDATE                  8S 0",
          "     D  SYY                    4S 0 OVERLAY(SDATE:1)",
          cEnd] },
  { n: "D4", why: "原典どおり ＋ OVERLAY",
    src: [dsHead("DATES"), sub("SDATE", 8, "S", 0),
          put(sub("SYY", 4, "S", 0), 44, "OVERLAY(SDATE:1)"), cEnd] }
];

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const c of CASES) await ifs.writeFile(`${IFS}/${c.n}.rpgle`, new TextEncoder().encode(c.src.join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }
const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPSRC) RCDLEN(112)`);
  for (const c of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.n}.rpgle') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPSRC.FILE/${c.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QTMPSRC) MBR(${c.n}) SRCTYPE(RPGLE)`);
    const r = await cmd.run(`CRTBNDRPG PGM(${LIB}/${c.n}) SRCFILE(${LIB}/QTMPSRC) SRCMBR(${c.n}) REPLACE(*YES)`);
    console.log(`${r.success ? "通る  " : "通らない"} ${c.n} ${c.why}`);
    if (!r.success) for (const l of c.src) console.log("    ", JSON.stringify(l));
    if (r.success) await cmd.run(`DLTPGM PGM(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QTMPSRC) MBR(${c.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${c.n}.rpgle')`);
  }
  await cmd.run(`DLTF FILE(${LIB}/QTMPSRC)`);
} finally { cmd.close(); }
