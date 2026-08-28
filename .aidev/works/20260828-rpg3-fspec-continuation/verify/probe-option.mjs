// F 仕様の継続行の「選択」欄(54-59)に何が入るかを実機に言わせる。
// 原典が無いので候補を自分の知識から作らない——**でたらめな選択を書いて、
// コンパイラが有効な集合を並べてくれるか**を見る（QRG6016 / QRG2016 はそうだった）。
// 土台は 20260828-rpg3-numeric-fields の W4（`K` ＋ INFDS ＋ データ構造名で通る形）。
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

const fIn  = () => at("F", [7, "INFILE"], [15, "I"], [16, "P"], [19, "F"], [24, "  80"], [40, "DISK"]);
const iRec = () => at("I", [7, "INFILE"], [15, "NS"], [19, "01"]);
const iFld = () => at("I", [44, "   1"], [48, "  10"], [53, "NAME"]);
const iDs  = () => [at("I", [7, "FDS"], [19, "DS"]), at("I", [44, "   1"], [48, "  80"], [53, "FDUMMY"])];
const END  = at("C", [28, "SETON"], [54, "LR"]);
const cont = (opt, entry) => at("F", [53, "K"], [54, opt], ...(entry ? [[60, entry]] : []));

const CASES = [
  { n: "C1", why: "対照: `INFDS` ＋ データ構造名（前 work で通ることを確認済み）",
    src: [fIn(), cont("INFDS", "FDS"), iRec(), iFld(), ...iDs(), END], expect: true },
  { n: "C2", why: "**でたらめな選択** `ZZZZZZ`（有効な集合を並べてくれるか）",
    src: [fIn(), cont("ZZZZZZ", "FDS"), iRec(), iFld(), ...iDs(), END], expect: false }
];

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const x of CASES) await ifs.writeFile(`${IFS}/${x.n}.rpg`, new TextEncoder().encode(x.src.join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }
const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPSRC) RCDLEN(112)`);
  for (const x of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${x.n}.rpg') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPSRC.FILE/${x.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QTMPSRC) MBR(${x.n}) SRCTYPE(RPG)`);
    const r = await cmd.run(`CRTRPGPGM PGM(${LIB}/${x.n}) SRCFILE(${LIB}/QTMPSRC) SRCMBR(${x.n}) REPLACE(*YES)`);
    console.log(`${r.success === x.expect ? "期待どおり" : "**食い違う**"} ${x.n} ${r.success ? "通る  " : "通らない"} — ${x.why}`);
    if (r.success) await cmd.run(`DLTPGM PGM(${LIB}/${x.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QTMPSRC) MBR(${x.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${x.n}.rpg')`);
  }
  await cmd.run(`DLTF FILE(${LIB}/QTMPSRC)`);
} finally { cmd.close(); }
