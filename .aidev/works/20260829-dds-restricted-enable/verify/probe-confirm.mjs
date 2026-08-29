// 網羅の結果、**原典に無いのに指摘が出なかった値**を単独で確かめる。
// 一括では他行の誤りで作成が失敗するため「指摘が無い＝有効」と断定できない。
// 単独で作成できれば有効。あわせて PF のリストが取れなかった件も調べる。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const { CommandConnection, IfsConnection, DbConnection, query } =
  await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;
const put = (l, c, v) => { const a = l.padEnd(80).split(""); for (let i = 0; i < v.length; i += 1) a[c - 1 + i] = v[i]; return a.join("").replace(/ +$/u, ""); };
const A = (...p) => p.reduce((l, [c, v]) => put(l, c, v), put(" ".repeat(80), 6, "A"));

const CASES = [
  // 対照（原典にあり、通ると分かっている）
  { n: "C1", type: "DSPF", crt: "CRTDSPF", src: [A([17,"R"],[19,"R1"]), A([19,"F1"],[30,"   10"],[35,"A"],[39,"  1"],[42,"  2"])], why: "対照 DSPF 35=A", expect: true },
  { n: "C2", type: "DSPF", crt: "CRTDSPF", src: [A([17,"R"],[19,"R1"]), A([19,"F1"],[30,"   10"],[35,"Q"],[39,"  1"],[42,"  2"])], why: "対照 DSPF 35=Q（原典に無い）", expect: false },
  // 網羅で「指摘なし」だったが原典に無い値
  { n: "V1", type: "DSPF", crt: "CRTDSPF", src: [A([17,"R"],[19,"R1"]), A([19,"F1"],[30,"   10"],[35,"V"],[39,"  1"],[42,"  2"])], why: "**DSPF 35=V**（原典に無い）" },
  { n: "G1", type: "PRTF", crt: "CRTPRTF", src: [A([17,"R"],[19,"R1"]), A([19,"F1"],[30,"   10"],[35,"G"],[39,"  1"],[42,"  2"])], why: "**PRTF 35=G**（原典に無い）" },
  { n: "O1", type: "PRTF", crt: "CRTPRTF", src: [A([17,"R"],[19,"R1"]), A([19,"F1"],[30,"   10"],[35,"O"],[39,"  1"],[42,"  2"])], why: "**PRTF 35=O**（原典に無い）" },
  { n: "B1", type: "PRTF", crt: "CRTPRTF", src: [A([17,"R"],[19,"R1"]), A([19,"F1"],[30,"   10"],[35,"A"],[39,"  1"],[42,"  2"])], why: "対照 PRTF 35=A", expect: true },
  // PF は最小の形（位置欄なし）
  { n: "PF1", type: "PF", crt: "CRTPF", src: [A([17,"R"],[19,"R1"]), A([19,"F1"],[30,"   10"],[35,"A"])], why: "対照 PF 35=A", expect: true },
  { n: "PF2", type: "PF", crt: "CRTPF", src: [A([17,"R"],[19,"R1"]), A([19,"F1"],[30,"   10"],[35,"Q"])], why: "対照 PF 35=Q（原典に無い）", expect: false }
];

const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const c of CASES) await ifs.writeFile(`${IFS}/${c.n}.dds`, new TextEncoder().encode(c.src.join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }
const db = await DbConnection.connect({ ...creds, resolvePort: true });
const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPDDS) RCDLEN(112)`);
  for (const c of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.n}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPDDS.FILE/${c.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QTMPDDS) MBR(${c.n}) SRCTYPE(${c.type})`);
    const r = await cmd.run(`${c.crt} FILE(${LIB}/${c.n}) SRCFILE(${LIB}/QTMPDDS) SRCMBR(${c.n}) REPLACE(*YES)`);
    const mark = c.expect !== undefined && c.expect !== r.success ? "  ← **対照が食い違う**" : "";
    console.log(`${c.n.padEnd(4)} 作成=${r.success ? "○" : "×"}  ${c.why}${mark}`);
    if (r.success) await cmd.run(`DLTF FILE(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QTMPDDS) MBR(${c.n})`);
  }
  // PF のリストのスプール名を確かめる（前回 0 件だった）
  const q = await query(db, `SELECT SPOOLED_FILE_NAME, FILE_NUMBER FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
    WHERE USER_NAME = CURRENT_USER ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 6 ROWS ONLY`);
  console.log("\n直近のスプール:", (q.rows ?? []).map(r => `${r.SPOOLED_FILE_NAME}#${r.FILE_NUMBER}`).join(" "));
  await cmd.run(`DLTF FILE(${LIB}/QTMPDDS)`);
} finally {
  cmd.close(); db.close();
  const clean = await IfsConnection.connect({ ...creds, resolvePort: true });
  try { for (const c of CASES) await clean.deleteFile(`${IFS}/${c.n}.dds`).catch(() => {}); } finally { clean.close(); }
}
