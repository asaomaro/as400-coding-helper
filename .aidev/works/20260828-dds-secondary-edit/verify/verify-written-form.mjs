// **編集が書き出した実物を実機に通す。**
// テストは形を固定するだけなので、その形が実機で通ることは別に確かめる。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const EXT = "/workspaces/as400-coding-helper/vscode-extension";
const { applyDdsEdits } = await import(join(EXT, "out/core/dds/ddsEdit.js"));

const BASE = [
  "     A                                      DSPSIZ(24 80 27 132)",
  "     A          R MAIN",
  "     A            FLDA          10A  B 23  2COLOR(RED) +",
  "     A                                      DSPATR(RI)",
  "     A N01        FLDB          10A  B  5  2",
  "     A            FLDC          10A  B  6  2"
];
const run = (lines, edits) => {
  const results = applyDdsEdits(lines, edits, "DDS-DSPF");
  if (results.length === 0) throw new Error(`編集が当たらなかった: ${JSON.stringify(edits)}`);
  const out = [...lines];
  for (const r of results) out.splice(r.replaceFrom, r.replaceTo - r.replaceFrom, ...r.lines);
  return out;
};
// 継続を持つ項目 / 条件つきの項目 / 素の項目 に上書き行を作り、最後に 1 本を置き換える。
let lines = run(BASE, [{ kind: "move", sourceLine: 3, row: 26, column: 100, screenSize: "secondary" }]);
lines = run(lines, [{ kind: "move", sourceLine: 6, row: 9, column: 40, screenSize: "secondary" }]);
lines = run(lines, [{ kind: "move", sourceLine: 8, row: 10, column: 50, screenSize: "secondary" }]);
lines = run(lines, [{ kind: "move", sourceLine: 3, row: 27, column: 120, screenSize: "secondary" }]);
// 消す経路も通す（別のメンバーとして）。
const cleared = run(lines, [{ kind: "clearAlternatePosition", sourceLine: 6 }]);

console.log(lines.join("\n"));

const hs = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;

const CASES = [
  { n: "W1", why: "編集が書いた 3 本の上書き行（継続あと / 条件つき / 素）", src: lines },
  { n: "W2", why: "clearAlternatePosition で 1 本消した結果", src: cleared }
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
    console.log(`${r.success ? "通る  " : "通らない"} ${c.n} ${c.why}`);
    if (!r.success) bad += 1;
    if (r.success) await cmd.run(`DLTF FILE(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QDDSSRCJ) MBR(${c.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${c.n}.dds')`);
  }
} finally { cmd.close(); }
process.exit(bad === 0 ? 0 : 1);
