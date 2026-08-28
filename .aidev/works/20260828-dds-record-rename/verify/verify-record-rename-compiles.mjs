// **様式の改名が書き出した実物を実機に通す。**
// 対照つき——追随しない形（様式だけ改名）は通らないことも見る。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const EXT = "/workspaces/as400-coding-helper/vscode-extension";
const { applyDdsEdits } = await import(join(EXT, "out/core/dds/ddsEdit.js"));

const BASE = [
  "     A                                      PASSRCD(SFLREC)",
  "     A          R SFLREC                    SFL",
  "     A            SFLFLD        10A  O  5  2",
  "     A          R CTLREC                    SFLCTL(SFLREC)",
  "     A                                      SFLSIZ(20)",
  "     A                                      SFLPAG(10)",
  "     A                                      SFLDSP",
  "     A                                      OVERLAY",
  "     A                                      ERASE(SFLREC)"
];

const run = (lines, edits) => {
  const results = applyDdsEdits(lines, edits, "DDS-DSPF");
  if (results.length === 0) throw new Error("編集が当たらなかった");
  const out = [...lines];
  for (const r of results) out.splice(r.replaceFrom, r.replaceTo - r.replaceFrom, ...r.lines);
  return out;
};

const followed = run(BASE, [{ kind: "renameRecord", sourceLine: 2, name: "NEWSFL" }]);
// 対照: 様式の行だけを直し、参照は古いまま。
const notFollowed = BASE.map(line =>
  line.includes("R SFLREC") ? line.replace("R SFLREC", "R NEWSFL") : line
);

console.log(followed.join("\n"));

const hs = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;

const CASES = [
  { n: "V0", why: "元のソース（対照・通るはず）", src: BASE, expect: true },
  { n: "V1", why: "追随あり（SFLCTL / ERASE / PASSRCD も直る）", src: followed, expect: true },
  { n: "V2", why: "追随なし（様式だけ改名）＝ 通らないはず", src: notFollowed, expect: false }
];

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const c of CASES) await ifs.writeFile(`${IFS}/${c.n}.dds`, new TextEncoder().encode(c.src.join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }
const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
let bad = 0;
try {
  for (const c of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.n}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QDDSSRCJ.FILE/${c.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QDDSSRCJ) MBR(${c.n}) SRCTYPE(DSPF)`);
    const r = await cmd.run(`CRTDSPF FILE(${LIB}/${c.n}) SRCFILE(${LIB}/QDDSSRCJ) SRCMBR(${c.n}) REPLACE(*YES)`);
    const ok = r.success === c.expect;
    if (!ok) bad += 1;
    console.log(`${ok ? "期待どおり" : "**食い違う**"} ${c.n} ${r.success ? "通る" : "通らない"} — ${c.why}`);
    if (r.success) await cmd.run(`DLTF FILE(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QDDSSRCJ) MBR(${c.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${c.n}.dds')`);
  }
} finally { cmd.close(); }
process.exit(bad === 0 ? 0 : 1);
