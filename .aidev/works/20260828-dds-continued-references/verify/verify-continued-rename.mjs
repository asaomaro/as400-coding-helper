// **継続にまたがる参照を追った結果**を実機に通す。
// 折り直しが入るので、書き出した形がそのまま通ることを見る必要がある。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const EXT = "/workspaces/as400-coding-helper/vscode-extension";
const { applyDdsEdits } = await import(join(EXT, "out/core/dds/ddsEdit.js"));

// CSRLOC が `+` の継続にまたがる形（原典どおり、`+` は先頭の空白を捨てる）。
// **SFLCSRRRN はサブファイル制御レコードにしか書けない。**
// 最初は素の様式に書いて対照ごと落ちた（対照を置いていなければ
// 「折り直した形が通らない」と誤読していた）。
const BASE = [
  "     A                                      DSPSIZ(24 80)",
  "     A          R SFLREC                    SFL",
  "     A            SFLFLD        10A  O  5  2",
  "     A          R CTLREC                    SFLCTL(SFLREC) +",
  "     A                                      CSRLOC(CSRROW +",
  "     A                                      CSRCOL)",
  "     A                                      SFLSIZ(20)",
  "     A                                      SFLPAG(10)",
  "     A                                      SFLDSP",
  "     A                                      OVERLAY",
  "     A                                      SFLCSRRRN(&SFLRRN)",
  "     A            CSRROW         3S 0H",
  "     A            CSRCOL         3S 0H",
  "     A            SFLRRN         5S 0H"
];

const run = (lines, edits) => {
  const results = applyDdsEdits(lines, edits, "DDS-DSPF");
  if (results.length === 0) throw new Error(`編集が当たらなかった: ${JSON.stringify(edits)}`);
  const out = [...lines];
  for (const r of results) out.splice(r.replaceFrom, r.replaceTo - r.replaceFrom, ...r.lines);
  return out;
};

// 継続の**後ろ側**にある名前（CSRCOL）を変える。折り直しが起きる。
const baseFieldLine = name =>
  BASE.findIndex(l => l.slice(18, 28).trim() === name && l.slice(29, 34).trim().length > 0) + 1;
let followed = run(BASE, [
  { kind: "setAttributes", sourceLine: baseFieldLine("CSRCOL"), attributes: { name: "NEWCOL" } }
]);
// 前側も変える。
// **項目の定義行**を探す（19-28 桁が名前・30-34 桁に長さ）。
// `includes` で探すと `CSRLOC(CSRROW +` の方に当たる。
const fieldLine = name =>
  followed.findIndex(l => l.slice(18, 28).trim() === name && l.slice(29, 34).trim().length > 0) + 1;
followed = run(followed, [
  { kind: "setAttributes", sourceLine: fieldLine("CSRROW"), attributes: { name: "NEWROW" } }
]);

console.log(followed.join("\n"));

const hs = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;

const CASES = [
  { n: "T0", why: "元のソース（継続あり・対照）", src: BASE, expect: true },
  { n: "T1", why: "継続にまたがる参照を追った結果（折り直しあり）", src: followed, expect: true }
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
