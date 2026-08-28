// 3 回目の取り直し。前回は**こちらの仕掛けが誤っていた**:
//   R4/R5: チャネルに `CH` と書いた（実機のチャネルは 01-12 / FL / OL）。
//   R7: 継続の `K` をファイルの行そのものに置いた（継続は**次の行**に書く）。
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
const iDs    = () => [at("I", [7, "FDS"], [19, "DS"]), at("I", [44, "   1"], [48, "  80"], [53, "FDUMMY"])];
const END    = at("C", [28, "SETON"], [54, "LR"]);
const oRec   = () => at("O", [7, "PRINT"], [15, "D"], [18, "1"]);
const oFld   = () => at("O", [32, "NAME"], [40, "  30"]);
// 12 本目: 行 70-72 / チャネル 73-74。チャネルは 01-12 / FL / OL。
const lLine  = (x = []) => at("L", [7, "PRINT"], [15, " 66"], [18, "FL"], [20, " 60"], [23, "OL"], ...x);
// 継続行: 53 桁目 `K` / 選択 54-59 / 記入 60-65
const fCont  = (opt, entry) => at("F", [53, "K"], [54, opt], [60, entry]);

const l = x => [fIn(), fPrint([[39, "L"]]), lLine(x), iRec(), iFld(), END, oRec(), oFld()];

const CASES = [
  { n: "W1", why: "対照: L 仕様 12 本目 行 70-72 ` 55` ／ チャネル 73-74 `01`",
    src: l([[70, " 55"], [73, "01"]]), expect: true },
  { n: "W2", why: "12 本目の行番号 70-72 に**英字** ` 5A`",
    src: l([[70, " 5A"], [73, "01"]]), expect: false },
  { n: "W3", why: "12 本目の行番号 70-72 を**左詰め** `55 `",
    src: l([[70, "55 "], [73, "01"]]), expect: false },
  { n: "W4", why: "**継続行**: 53 桁目 `K` ／ 54-59 `INFDS` ／ 60-65 にデータ構造名（53 が継続欄であることの裏取り）",
    src: [fIn(), fCont("INFDS", "FDS"), iRec(), iFld(), ...iDs(), END], expect: true }
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
    const ok = r.success === x.expect;
    if (!ok) bad += 1;
    console.log(`${ok ? "期待どおり" : "**食い違う**"} ${x.n} ${r.success ? "通る  " : "通らない"} — ${x.why}`);
    if (r.success) await cmd.run(`DLTPGM PGM(${LIB}/${x.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QTMPSRC) MBR(${x.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${x.n}.rpg')`);
  }
  await cmd.run(`DLTF FILE(${LIB}/QTMPSRC)`);
} finally { cmd.close(); }
console.log(`\n食い違い ${bad} 件`);
process.exit(bad === 0 ? 0 : 1);
