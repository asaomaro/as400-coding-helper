// 前回で理由が分かった: **F 仕様の書き方は合っていて、参照先が *LIBL に無かっただけ**
// （CPF5715）。コンパイル・ジョブは毎回別なので ADDLIBLE が効かない。
// **既定で *LIBL に載っている QGPL に CUSTMAS を作って**確かめる（終わったら消す）。
//
// 対照を必ず添える: 直した形（定義どおりの桁）と、直す前の形（現在のサンプル）。
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

const FIXED = [
  at("H"),
  at("F", [7, "CUSTMAS"], [15, "I"], [16, "F"], [19, "E"], [31, "K"], [40, "DISK"]),
  at("F", [7, "PRINT"], [15, "O"], [19, "F"], [24, " 132"], [33, "OF"], [40, "PRINTER"]),
  at("I", [7, "CUSTMAS"], [15, "NS"], [19, "01"]),
  at("C", [28, "MOVEL"], [33, "*BLANKS"], [43, "NAME"]),
  at("C", [18, "CUSTNO"], [28, "CHAIN"], [33, "CUSTMAS"], [57, "99"]),
  at("C", [28, "Z-ADD"], [33, "0"], [43, "TOTAL"], [49, "  6"], [52, "0"]),
  at("C", [28, "EXSR "], [33, "CALC"]),
  at("C", [18, "CALC"], [28, "BEGSR"]),
  at("C", [18, "AMOUNT"], [28, "ADD  "], [33, "TAX"], [43, "TOTAL"]),
  at("C", [28, "ENDSR"]),
  at("O", [7, "PRINT"], [15, "D"], [18, "1"]),
  at("O", [32, "NAME"], [40, "  30"])
];
const CURRENT = readFileSync("/workspaces/as400-coding-helper/docs/src/RPG3SAMP.rpg", "utf8")
  .split(/\r?\n/u).filter(line => line.trim() !== "");

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try {
  await ifs.writeFile(`${IFS}/S9.rpg`, new TextEncoder().encode(FIXED.join("\n") + "\n"), { create: true, truncate: true });
  await ifs.writeFile(`${IFS}/S7.rpg`, new TextEncoder().encode(CURRENT.join("\n") + "\n"), { create: true, truncate: true });
} finally { ifs.close(); }

const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
const run = async (c, quiet) => {
  const r = await cmd.run(c);
  if (!quiet || !r.success) console.log(`${r.success ? "OK  " : "NG  "} ${c.slice(0, 58)}`);
  if (!r.success && !quiet) for (const m of r.messages ?? []) console.log(`      ${m.id} ${m.text}`);
  return r;
};
try {
  // *LIBL に載る QGPL に置く（コンパイル・ジョブは毎回別なので ADDLIBLE では届かない）
  await run(`CRTDUPOBJ OBJ(CUSTMAS) FROMLIB(${LIB}) OBJTYPE(*FILE) TOLIB(QGPL)`);
  for (const [n, why] of [["S9", "**直した形**（定義どおりの桁）"], ["S7", "対照: **いまのサンプル**（桁がずれた形）"]]) {
    await run(`CPYFRMSTMF FROMSTMF('${IFS}/${n}.rpg') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPSRC.FILE/${n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`, true);
    await run(`CHGPFM FILE(${LIB}/QTMPSRC) MBR(${n}) SRCTYPE(RPG)`, true);
    const r = await cmd.run(`CRTRPGPGM PGM(${LIB}/${n}) SRCFILE(${LIB}/QTMPSRC) SRCMBR(${n}) REPLACE(*YES)`);
    console.log(`${r.success ? "通る  " : "通らない"} ${n} — ${why}`);
    if (!r.success) for (const m of r.messages ?? []) console.log(`        ${m.id} ${m.text}`);
    if (r.success) await run(`DLTPGM PGM(${LIB}/${n})`, true);
  }
} finally {
  await run(`DLTF FILE(QGPL/CUSTMAS)`, true);
  cmd.close();
}
