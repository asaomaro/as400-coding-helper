/**
 * **1 桁目に項目を置いた DSPF は実機でコンパイルが通るか。**
 *
 * 原典は「この指定は無効です」と書くが、既存のテストは「規則違反は拒否しない
 * （直すために動かせる必要がある）」と決めていた。どちらを採るかは
 * **実機のコンパイラに判定させる**（AGENTS.md）。
 * 併せて、重なり・はみ出しが通ることも確かめる（こちらは止めるべきでない）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const hs = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;

const put = (l, c, v) => { const a = l.split(""); for (let i = 0; i < v.length; i += 1) a[c - 1 + i] = v[i]; return a.join(""); };
const A = () => put(" ".repeat(80), 6, "A");

const mk = (name, why, row, col, kind) => {
  const rec = put(put(A(), 17, "R"), 19, name);
  let line = put(put(A(), 39, String(row).padStart(3)), 42, String(col).padStart(3));
  if (kind === "field") {
    line = put(put(put(put(line, 19, "F1"), 30, "    5"), 35, "A"), 38, "O");
  } else {
    line = put(line, 45, "'X'");
  }
  return { name, why, src: [rec, line] };
};

const CASES = [
  mk("R1C1",  "定数を 1 行 1 桁に（原典が「無効」と書く形）", 1, 1, "const"),
  mk("R1C1F", "フィールドを 1 行 1 桁に", 1, 1, "field"),
  mk("R2C1",  "定数を 2 行 1 桁に", 2, 1, "const"),
  mk("R2C1F", "フィールドを 2 行 1 桁に", 2, 1, "field"),
  mk("R1C2",  "定数を 1 行 2 桁に（属性は 1 行 1 桁）", 1, 2, "const")
];

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try {
  for (const c of CASES) {
    await ifs.writeFile(`${IFS}/${c.name}.dds`, new TextEncoder().encode(c.src.map(l => l.replace(/ +$/u, "")).join("\n") + "\n"), { create: true, truncate: true });
  }
} finally { ifs.close(); }

const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
try {
  for (const c of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.name}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QDDSSRCJ.FILE/${c.name}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QDDSSRCJ) MBR(${c.name}) SRCTYPE(DSPF)`);
    const r = await cmd.run(`CRTDSPF FILE(${LIB}/${c.name}) SRCFILE(${LIB}/QDDSSRCJ) SRCMBR(${c.name}) REPLACE(*YES)`);
    console.log(`${r.success ? "通る  " : "通らない"} ${c.name.padEnd(9)} ${c.why}`);
    const msgs = (r.messages ?? []).map(m => `${m.id} ${m.text}`).join(" / ");
    if (msgs) console.log("         ", msgs.slice(0, 220));
    if (r.success) await cmd.run(`DLTF FILE(${LIB}/${c.name})`);
    await cmd.run(`RMVM FILE(${LIB}/QDDSSRCJ) MBR(${c.name})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${c.name}.dds')`);
  }
} finally { cmd.close(); }
