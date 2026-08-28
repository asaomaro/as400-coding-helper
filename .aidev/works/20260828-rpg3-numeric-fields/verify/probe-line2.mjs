// L 仕様の 2 本目の行番号（20-22）。1 本目と同じ扱いかを確かめる（推測で同じ扱いにしない）。
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
const l = v => [at("F", [7, "INFILE"], [15, "I"], [16, "P"], [19, "F"], [24, "  80"], [40, "DISK"]),
  at("F", [7, "PRINT"], [15, "O"], [19, "F"], [24, " 132"], [33, "OF"], [39, "L"], [40, "PRINTER"]),
  at("L", [7, "PRINT"], [15, " 66"], [18, "FL"], [20, v], [23, "OL"]),
  at("I", [7, "INFILE"], [15, "NS"], [19, "01"]), at("I", [44, "   1"], [48, "  10"], [53, "NAME"]),
  at("C", [28, "SETON"], [54, "LR"]), at("O", [7, "PRINT"], [15, "D"], [18, "1"]), at("O", [32, "NAME"], [40, "  30"])];
const CASES = [
  { n: "Y1", why: "対照: 2 本目の行番号 20-22 に ` 60`", src: l(" 60"), expect: true },
  { n: "Y2", why: "2 本目の行番号に**英字** ` 6A`",      src: l(" 6A"), expect: false },
  { n: "Y3", why: "2 本目の行番号を**左詰め** `60 `",    src: l("60 "), expect: false }
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
    const ok = r.success === x.expect; if (!ok) bad += 1;
    console.log(`${ok ? "期待どおり" : "**食い違う**"} ${x.n} ${r.success ? "通る  " : "通らない"} — ${x.why}`);
    if (r.success) await cmd.run(`DLTPGM PGM(${LIB}/${x.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QTMPSRC) MBR(${x.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${x.n}.rpg')`);
  }
  await cmd.run(`DLTF FILE(${LIB}/QTMPSRC)`);
} finally { cmd.close(); }
console.log(`\n食い違い ${bad} 件`);
process.exit(bad === 0 ? 0 : 1);
