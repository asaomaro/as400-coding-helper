// **直したサンプルの D 仕様が実機でコンパイルを通ることを確かめる。**
// 直す前は通らないことも見る（対照）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const S = "/tmp/claude-1000/-workspaces-as400-coding-helper/2a80b637-f109-4980-af96-91d217b4b087/scratchpad";
const hs = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;

// 直す前の形（長さ 32 / 型 33 / 小数 35）に戻した対照。
const BEFORE = [
  "     D DATES           DS",
  "     D  SDATE                  8S 0",
  "     D  SYY                    4S 0 OVERLAY(SDATE:1)",
  "     C                   SETON                                        LR"
];

const CASES = [
  { n: "DS1", why: "EMPMNT01 の D 仕様（直したもの）", src: readFileSync(`${S}/DS1.rpgle`, "utf8").split("\n").filter(l => l.trim()), expect: true },
  { n: "DS2", why: "SLSENT01 の D 仕様（直したもの）", src: readFileSync(`${S}/DS2.rpgle`, "utf8").split("\n").filter(l => l.trim()), expect: true },
  { n: "DS0", why: "**直す前の形**（対照・通らないはず）", src: BEFORE, expect: false }
];

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const c of CASES) await ifs.writeFile(`${IFS}/${c.n}.rpgle`, new TextEncoder().encode(c.src.join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }
const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
let bad = 0;
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPSRC) RCDLEN(112)`);
  for (const c of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.n}.rpgle') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPSRC.FILE/${c.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QTMPSRC) MBR(${c.n}) SRCTYPE(RPGLE)`);
    const r = await cmd.run(`CRTBNDRPG PGM(${LIB}/${c.n}) SRCFILE(${LIB}/QTMPSRC) SRCMBR(${c.n}) REPLACE(*YES)`);
    const ok = r.success === c.expect;
    if (!ok) bad += 1;
    console.log(`${ok ? "期待どおり" : "**食い違う**"} ${c.n} ${r.success ? "通る" : "通らない"} — ${c.why}`);
    if (r.success) await cmd.run(`DLTPGM PGM(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QTMPSRC) MBR(${c.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${c.n}.rpgle')`);
  }
  await cmd.run(`DLTF FILE(${LIB}/QTMPSRC)`);
} finally { cmd.close(); }
process.exit(bad === 0 ? 0 : 1);
