// 様式名の規則を実機に判定させる。
//   - 同じ名前の様式を 2 つ置けるか（改名で衝突したときに拒否すべきか）
//   - 参照（SFLCTL / ERASE / PASSRCD / HLPRCD）が**存在しない様式**を指すと落ちるか
//     （落ちるなら、改名の追随に値打ちがある）
//   - HLPRCD はファイル名を添えると外部を指す（原典）——添えた形が通るか
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
const T = l => l.replace(/ +$/u, "");
const kw = t => T(put(A(), 45, t));
const rec = n => T(put(put(A(), 17, "R"), 19, n));
const recKw = (n, t) => T(put(put(put(A(), 17, "R"), 19, n), 45, t));
const fld = (n, row, col, use = "B") =>
  T(put(put(put(put(put(put(A(), 19, n), 30, "   10"), 35, "A"), 38, use), 39, String(row).padStart(3)), 42, String(col).padStart(3)));

const sfl = ctlName => [
  recKw("SFLREC", "SFL"),
  fld("SFLFLD", 5, 2, "O"),
  recKw("CTLREC", `SFLCTL(${ctlName})`),
  kw("SFLSIZ(20)"), kw("SFLPAG(10)"), kw("SFLDSP"), kw("OVERLAY")
];

const CASES = [
  { n: "N1", why: "**同じ名前の様式を 2 つ**", src: [rec("SAME"), fld("F1", 5, 2), rec("SAME"), fld("F2", 6, 2)] },
  { n: "N2", why: "別々の名前（対照）", src: [rec("REC1"), fld("F1", 5, 2), rec("REC2"), fld("F2", 6, 2)] },
  { n: "N3", why: "SFLCTL が正しい様式を指す（対照）", src: sfl("SFLREC") },
  { n: "N4", why: "**SFLCTL が存在しない様式を指す**（追随しないとこうなる）", src: sfl("OLDNAME") },
  { n: "N5", why: "ERASE が正しい様式を指す（対照）", src: [rec("REC1"), fld("F1", 5, 2), recKw("REC2", "OVERLAY"), kw("ERASE(REC1)"), fld("F2", 6, 2)] },
  { n: "N6", why: "**ERASE が存在しない様式を指す**", src: [rec("REC1"), fld("F1", 5, 2), recKw("REC2", "OVERLAY"), kw("ERASE(GONE)"), fld("F2", 6, 2)] },
  { n: "N7", why: "PASSRCD が正しい様式を指す（対照）", src: [kw("PASSRCD(REC1)"), rec("REC1"), fld("F1", 5, 2)] },
  { n: "N8", why: "**PASSRCD が存在しない様式を指す**", src: [kw("PASSRCD(GONE)"), rec("REC1"), fld("F1", 5, 2)] },
  { n: "N9", why: "HLPRCD がこのファイルの様式を指す（ファイル名なし・対照）", src: [kw("HLPRCD(HELPREC)"), rec("HELPREC"), fld("HF", 5, 2, "O"), rec("REC1"), fld("F1", 6, 2)] },
  { n: "NA", why: "**HLPRCD がファイル名つき**（外部を指す＝追ってはいけない）", src: [kw("HLPRCD(DFTHELP HELPFILE)"), rec("REC1"), fld("F1", 5, 2)] },
  { n: "NB", why: "HLPRCD がファイル名なしで存在しない様式を指す", src: [kw("HLPRCD(GONE)"), rec("REC1"), fld("F1", 5, 2)] },
  { n: "NC", why: "様式名 10 文字（上限）", src: [rec("ABCDEFGHIJ"), fld("F1", 5, 2)] },
  { n: "ND", why: "様式名 11 文字（上限超え）", src: [T(put(put(A(), 17, "R"), 19, "ABCDEFGHIJK")), fld("F1", 5, 2)] }
];

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const c of CASES) await ifs.writeFile(`${IFS}/${c.n}.dds`, new TextEncoder().encode(c.src.join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }
const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
try {
  for (const c of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.n}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QDDSSRCJ.FILE/${c.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QDDSSRCJ) MBR(${c.n}) SRCTYPE(DSPF)`);
    const r = await cmd.run(`CRTDSPF FILE(${LIB}/${c.n}) SRCFILE(${LIB}/QDDSSRCJ) SRCMBR(${c.n}) REPLACE(*YES)`);
    console.log(`${r.success ? "通る  " : "通らない"} ${c.n} ${c.why}`);
    if (r.success) await cmd.run(`DLTF FILE(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QDDSSRCJ) MBR(${c.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${c.n}.dds')`);
  }
} finally { cmd.close(); }
