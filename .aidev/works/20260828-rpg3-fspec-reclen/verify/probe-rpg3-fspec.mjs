// **F 仕様の桁は定義とサンプルのどちらが正しいか**を実機に判定させる。
// 定義: 種別 15 / 指定 16。サンプル(`RPG3SAMP.rpg`): 16 / 17 に見える。
// 土台は I 仕様の probe で**通ることを確かめた形**を使う。
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
const spec = s => put(" ".repeat(80), 6, s);

/** 定義どおり: 種別 15 / 指定 16 / 形式 19 / レコード長 24-27 / 装置 40-46 */
const fByDefinition = reclen => {
  let l = put(put(put(put(spec("F"), 7, "INFILE"), 15, "I"), 16, "P"), 19, "F");
  l = put(l, reclen.col, reclen.text);
  return put(l, 40, "DISK");
};
/** サンプルの見た目: 1 桁ずつ右 */
const fBySample = () => {
  let l = put(put(put(put(spec("F"), 7, "INFILE"), 16, "I"), 17, "P"), 20, "F");
  l = put(l, 25, "  80");
  return put(l, 41, "DISK");
};
const iRec = () => put(put(put(spec("I"), 7, "INFILE"), 15, "NS"), 19, "01");
const iFld = () => put(put(put(spec("I"), 44, "   1"), 48, "  10"), 53, "NAME");
const END = put(put(spec("C"), 28, "SETON"), 54, "LR");

const CASES = [
  { n: "S1", why: "対照: **定義どおりの桁**（種別 15 / レコード長 24-27 右寄せ）",
    src: [fByDefinition({ col: 24, text: "  80" }), iRec(), iFld(), END], expect: true },
  { n: "S2", why: "**サンプルの見た目**（1 桁ずつ右）",
    src: [fBySample(), iRec(), iFld(), END], expect: false },
  { n: "S3", why: "**レコード長を左詰め**（24 桁に `80`）",
    src: [fByDefinition({ col: 24, text: "80" }), iRec(), iFld(), END], expect: false },
  { n: "S4", why: "**レコード長に英字**",
    src: [fByDefinition({ col: 24, text: "  8A" }), iRec(), iFld(), END], expect: false }
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
    console.log(`${ok ? "期待どおり" : "**食い違う**"} ${x.n} ${r.success ? "通る" : "通らない"} — ${x.why}`);
    if (r.success) await cmd.run(`DLTPGM PGM(${LIB}/${x.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QTMPSRC) MBR(${x.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${x.n}.rpg')`);
  }
  await cmd.run(`DLTF FILE(${LIB}/QTMPSRC)`);
} finally { cmd.close(); }
process.exit(bad === 0 ? 0 : 1);
