// **改名の追随が実機で通ることを確かめる。**
//
// 単体テストは書き出す形を固定するだけなので、その形が実機で通ることは別に見る。
// 併せて「**追随しないと通らない**」ことも見る——追随の値打ちがそこにあるため、
// 対照が通ってしまうならこの機能は要らないことになる。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const EXT = "/workspaces/as400-coding-helper/vscode-extension";
const { applyDdsEdits } = await import(join(EXT, "out/core/dds/ddsEdit.js"));

// CSRLOC（様式のキーワード・定位置の項目名）と SFLCSRRRN(&…)（規則 A）を持つサブファイル。
const BASE = [
  "     A                                      DSPSIZ(24 80)",
  "     A          R SFLREC                    SFL",
  "     A            SFLFLD        10A  O  5  2",
  "     A          R CTLREC                    SFLCTL(SFLREC)",
  "     A                                      SFLSIZ(20)",
  "     A                                      SFLPAG(10)",
  "     A                                      SFLDSP",
  "     A                                      OVERLAY",
  "     A                                      CSRLOC(CSRROW CSRCOL)",
  "     A                                      SFLCSRRRN(&SFLRRN)",
  "     A            CSRROW         3S 0H",
  "     A            CSRCOL         3S 0H",
  "     A            SFLRRN         5S 0H"
];

const run = (lines, edits) => {
  const results = applyDdsEdits(lines, edits, "DDS-DSPF");
  if (results.length === 0) throw new Error("編集が当たらなかった");
  const out = [...lines];
  for (const r of results) out.splice(r.replaceFrom, r.replaceTo - r.replaceFrom, ...r.lines);
  return out;
};

// 追随あり: CSRROW → NEWROW / SFLRRN → NEWRRN
let followed = run(BASE, [{ kind: "setAttributes", sourceLine: 11, attributes: { name: "NEWROW" } }]);
followed = run(followed, [{ kind: "setAttributes", sourceLine: 13, attributes: { name: "NEWRRN" } }]);

// 対照: 項目の行だけを変え、参照は古いまま（追随しない場合に相当）。
const notFollowed = BASE.map(line =>
  line.includes("            CSRROW ") ? line.replace("CSRROW ", "NEWROW ") : line
);

console.log(followed.join("\n"));

const hs = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;

const CASES = [
  { n: "R0", why: "元のソース（対照・通るはず）", src: BASE, expect: true },
  { n: "R1", why: "追随あり（CSRLOC と &SFLRRN も直る）", src: followed, expect: true },
  { n: "R2", why: "追随なし（項目だけ改名）＝ 通らないはず", src: notFollowed, expect: false }
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
