// I / O 仕様の数値欄も実機に判定させる。**対照を先に通す。**
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

// プログラム記述の入力ファイル（F 仕様: 名前 7-14 / 種別 15 / 指定 16 / 形式 19 / レコード長 24-27 / 装置 40-46）
const fFile = () => {
  let l = put(put(put(put(spec("F"), 7, "INFILE"), 15, "I"), 16, "P"), 19, "F");
  l = put(l, 24, "  80");     // レコード長は 24-27（右寄せ）
  return put(l, 40, "DISK");
};
// I 仕様（レコード）: ファイル 7-14 / 順序 15-16 / 番号 17 / 選択 18
// **レコード識別標識は 19-20 桁**（17 / 18 ではない）。実サンプル
// `     ICUSTMAS  NS  01` の桁を数えて確かめた。
const iRec = () => put(put(put(spec("I"), 7, "INFILE"), 15, "NS"), 19, "01");
// I 仕様（フィールド）: 開始 44-47 / 終了 48-51 / 小数 52 / 名前 53-58
const iFld = (beg, end, dec, name) => {
  let l = spec("I");
  l = put(l, beg.col, beg.text);
  l = put(l, end.col, end.text);
  if (dec !== undefined) l = put(l, 52, dec);
  return put(l, 53, name);
};
const END = put(put(spec("C"), 28, "SETON"), 54, "LR");

const CASES = [
  { n: "I1", why: "対照: 開始 44-47 / 終了 48-51 を右寄せ（文字フィールド）",
    src: [fFile(), iRec(), iFld({ col: 44, text: "   1" }, { col: 48, text: "  10" }, undefined, "NAME"), END], expect: true },
  { n: "I2", why: "**開始を左詰め**（44 桁に `1`）",
    src: [fFile(), iRec(), iFld({ col: 44, text: "1" }, { col: 48, text: "  10" }, undefined, "NAME"), END], expect: false },
  { n: "I3", why: "**終了を左詰め**（48 桁に `10`）",
    src: [fFile(), iRec(), iFld({ col: 44, text: "   1" }, { col: 48, text: "10" }, undefined, "NAME"), END], expect: false },
  { n: "I4", why: "**開始欄に英字**",
    src: [fFile(), iRec(), iFld({ col: 44, text: "   A" }, { col: 48, text: "  10" }, undefined, "NAME"), END], expect: false },
  { n: "I5", why: "小数欄に数字（数値フィールド・対照）",
    src: [fFile(), iRec(), iFld({ col: 44, text: "  11" }, { col: 48, text: "  15" }, "0", "AMOUNT"), END], expect: true },
  { n: "I6", why: "**小数欄に英字**",
    src: [fFile(), iRec(), iFld({ col: 44, text: "  11" }, { col: 48, text: "  15" }, "A", "AMOUNT"), END], expect: false }
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
