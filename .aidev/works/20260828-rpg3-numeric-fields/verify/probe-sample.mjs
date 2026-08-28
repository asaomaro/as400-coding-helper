// `RPG3SAMP.rpg` の F/I/O 桁ずれを直す。前回は切り分けだけで理由が分からず止めたが、
// **コンパイル・リストがスプールから読める**ことが分かったので、理由を見て直す。
// 外部記述なので参照される CUSTMAS を先に作る。
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

// CUSTMAS: 定義どおりの桁で書いた DDS（キーつき物理ファイル）
const DDS = [
  "     A          R CUSTREC",
  "     A            CUSTNO         5A",
  "     A            NAME          30A",
  "     A            AMOUNT         7P 2",
  "     A            TAX            7P 2",
  "     A          K CUSTNO"
];
// 直した形（定義どおりの桁）
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
// 切り分け用: F 仕様 1 本 ＋ SETON だけ
const MINIMAL = [
  at("F", [7, "CUSTMAS"], [15, "I"], [16, "F"], [19, "E"], [31, "K"], [40, "DISK"]),
  at("C", [28, "SETON"], [54, "LR"])
];

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try {
  await ifs.writeFile(`${IFS}/CUSTMAS.dds`, new TextEncoder().encode(DDS.join("\n") + "\n"), { create: true, truncate: true });
  await ifs.writeFile(`${IFS}/S9.rpg`, new TextEncoder().encode(FIXED.join("\n") + "\n"), { create: true, truncate: true });
  await ifs.writeFile(`${IFS}/S8.rpg`, new TextEncoder().encode(MINIMAL.join("\n") + "\n"), { create: true, truncate: true });
} finally { ifs.close(); }

const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
const run = async (c) => { const r = await cmd.run(c); console.log(`${r.success ? "OK  " : "NG  "} ${c.slice(0, 62)}`); if (!r.success) for (const m of r.messages ?? []) console.log(`      ${m.id} ${m.text}`); return r; };
try {
  await run(`CRTSRCPF FILE(${LIB}/QTMPSRC) RCDLEN(112)`);
  await run(`CPYFRMSTMF FROMSTMF('${IFS}/CUSTMAS.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPSRC.FILE/CUSTMAS.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await run(`CHGPFM FILE(${LIB}/QTMPSRC) MBR(CUSTMAS) SRCTYPE(PF)`);
  await run(`CRTPF FILE(${LIB}/CUSTMAS) SRCFILE(${LIB}/QTMPSRC) SRCMBR(CUSTMAS) OPTION(*NOSRC) SIZE(*NOMAX)`);
  for (const n of ["S8", "S9"]) {
    await run(`CPYFRMSTMF FROMSTMF('${IFS}/${n}.rpg') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPSRC.FILE/${n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await run(`CHGPFM FILE(${LIB}/QTMPSRC) MBR(${n}) SRCTYPE(RPG)`);
    await run(`CRTRPGPGM PGM(${LIB}/${n}) SRCFILE(${LIB}/QTMPSRC) SRCMBR(${n}) REPLACE(*YES)`);
  }
} finally { cmd.close(); }
