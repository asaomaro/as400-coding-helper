// **F 仕様の継続行の「選択」欄(54-59) が受ける語を実機に選り分けさせる。**
//
// 候補の出どころ: **ILE の F 仕様キーワード 45 件**（`resources/completion/rpg-completion.json`。
// 原典から生成したもの）。自分の知識から候補を作らないための措置だが、
// **RPG III にしか無い語があれば取りこぼす**（RPG III の命令コードを採ったときと同じ限界）。
//
// 判別: `QRG2023『The Option entry is invalid』` は**重大度 30**。`GENLVL(20)` で流すと
// 30 以上だけが作成を止めるので、`r.success` がそのまま「選択欄として通る語か」になる。
// 対照として同じ仕掛けに `ZZZZZZ` を入れた版を必ず並べる（両方落ちたら判定不能）。
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

// 選択欄は 6 桁しかないので、7 文字以上の語は**桁で機械的に外れる**（知識ではない）
const ILE = JSON.parse(readFileSync("/workspaces/as400-coding-helper/vscode-extension/resources/completion/rpg-completion.json", "utf8"));
const NAMES = [...new Set(ILE.keywords["F-SPEC"].map(k => (typeof k === "string" ? k : k.name)))]
  .filter(n => /^[A-Z]+$/u.test(n) && n.length <= 6).sort();
console.log(`候補 ${NAMES.length} 件（ILE の F 仕様キーワード 45 件のうち 6 桁に収まるもの）:\n  ${NAMES.join(" ")}\n`);

const fIn  = () => at("F", [7, "INFILE"], [15, "I"], [16, "P"], [19, "F"], [24, "  80"], [40, "DISK"]);
const iRec = () => at("I", [7, "INFILE"], [15, "NS"], [19, "01"]);
const iFld = () => at("I", [44, "   1"], [48, "  10"], [53, "NAME"]);
const iDs  = () => [at("I", [7, "FDS"], [19, "DS"]), at("I", [44, "   1"], [48, "  80"], [53, "FDUMMY"])];
const END  = at("C", [28, "SETON"], [54, "LR"]);
const cont = (opt, entry) => at("F", [53, "K"], [54, opt], ...(entry ? [[60, entry]] : []));
const src  = (opt, entry) => [fIn(), cont(opt, entry), iRec(), iFld(), ...iDs(), END];

const CASES = [
  { n: "V0", opt: "INFDS",  entry: "FDS", why: "対照(有効)", expect: true },
  { n: "VZ", opt: "ZZZZZZ", entry: "FDS", why: "対照(無効)", expect: false },
  { n: "VB", opt: "ZZZZZZ", entry: "",    why: "対照(無効・記入なし)", expect: false }
];
NAMES.forEach((name, i) => {
  CASES.push({ n: `E${i}`, opt: name, entry: "FDS", why: `${name}（記入あり）`, expect: null });
  CASES.push({ n: `B${i}`, opt: name, entry: "",    why: `${name}（記入なし）`, expect: null });
});

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const x of CASES) await ifs.writeFile(`${IFS}/${x.n}.rpg`, new TextEncoder().encode(src(x.opt, x.entry).join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }

const ok = new Map();
const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
let broken = 0;
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPSRC) RCDLEN(112)`);
  for (const x of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${x.n}.rpg') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPSRC.FILE/${x.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QTMPSRC) MBR(${x.n}) SRCTYPE(RPG)`);
    const r = await cmd.run(`CRTRPGPGM PGM(${LIB}/${x.n}) SRCFILE(${LIB}/QTMPSRC) SRCMBR(${x.n}) REPLACE(*YES) GENLVL(20)`);
    if (x.expect !== null && r.success !== x.expect) { broken += 1; console.log(`**対照が食い違う** ${x.n} ${x.why}`); }
    if (x.expect === null) ok.set(x.opt, (ok.get(x.opt) ?? false) || r.success);
    if (r.success) await cmd.run(`DLTPGM PGM(${LIB}/${x.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QTMPSRC) MBR(${x.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${x.n}.rpg')`);
  }
  await cmd.run(`DLTF FILE(${LIB}/QTMPSRC)`);
} finally { cmd.close(); }

if (broken) { console.log(`\n**対照が ${broken} 件食い違った。判別が壊れているので結果を読まない。**`); process.exit(1); }
const valid = [...ok].filter(([, v]) => v).map(([k]) => k).sort();
const invalid = [...ok].filter(([, v]) => !v).map(([k]) => k).sort();
console.log(`\n実機が受ける選択 (${valid.length}):\n  ${valid.join(" ")}`);
console.log(`\n受けない (${invalid.length}):\n  ${invalid.join(" ")}`);
