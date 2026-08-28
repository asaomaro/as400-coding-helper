// **DBCS を含む行はどこで切れるか。** 書いて → メンバーへ入れて → 読み戻して比べる。
// 行長の数え方（JS の文字数 / 表示桁 / バイト）を決めるための材料。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const hs = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;
const conn = { ...creds, resolvePort: true };

const put = (l, c, v) => { const a = l.split(""); for (let i = 0; i < v.length; i += 1) a[c - 1 + i] = v[i]; return a.join(""); };
const A = () => put(" ".repeat(80), 6, "A");
const T = l => l.replace(/ +$/u, "");
const rec = n => T(put(put(A(), 17, "R"), 19, n));
// 定数（キーワード欄 45 桁〜）に DBCS を n 文字入れる。
const dbcs = (row, n) =>
  T(put(put(put(A(), 39, String(row).padStart(3)), 42, "  2"), 45, `'${"顧".repeat(n)}'`));
// 半角で同じ**JS 文字数**にした対照。
const sbcs = (row, n) =>
  T(put(put(put(A(), 39, String(row).padStart(3)), 42, "  2"), 45, `'${"X".repeat(n)}'`));

// 45 桁目から始めて 80 桁まで＝ 36 桁。`'…'` で 2 桁使うので中身は最大 34 文字。
// DBCS は 1 文字 = 2 表示桁なので 17 文字で 34 桁。**JS の文字数では 17。**
const CASES = [
  { n: "L1", why: "半角 34 文字（JS 34・表示 34・欄ぴったり）", src: [rec("MAIN"), sbcs(5, 34)] },
  { n: "L2", why: "半角 35 文字（欄からはみ出す）", src: [rec("MAIN"), sbcs(5, 35)] },
  { n: "L3", why: "**全角 17 文字（JS 17・表示 34・欄ぴったり）**", src: [rec("MAIN"), dbcs(5, 17)] },
  { n: "L4", why: "**全角 18 文字（JS 18・表示 36・欄からはみ出す）**", src: [rec("MAIN"), dbcs(5, 18)] },
  { n: "L5", why: "全角 30 文字（JS 30・表示 60）", src: [rec("MAIN"), dbcs(5, 30)] }
];

const ifs = await hs.IfsConnection.connect(conn);
try { for (const c of CASES) await ifs.writeFile(`${IFS}/${c.n}.dds`, new TextEncoder().encode(c.src.join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }

const cmd = await hs.CommandConnection.connect(conn);
try {
  for (const c of CASES) {
    const line = c.src[1];
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.n}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QDDSSRCJ.FILE/${c.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QDDSSRCJ) MBR(${c.n}) SRCTYPE(DSPF)`);
    // **読み戻して比べる。** 切れていれば中身が短くなる。
    await cmd.run(`CPYTOSTMF FROMMBR('/QSYS.LIB/${LIB}.LIB/QDDSSRCJ.FILE/${c.n}.MBR') TOSTMF('${IFS}/${c.n}.back') STMFOPT(*REPLACE) STMFCCSID(1208)`);
    const back = await (async () => {
      const i2 = await hs.IfsConnection.connect(conn);
      try { return new TextDecoder().decode(await i2.readFile(`${IFS}/${c.n}.back`)); }
      finally { i2.close(); }
    })();
    const got = back.split(/\r?\n/u)[1] ?? "";
    const r = await cmd.run(`CRTDSPF FILE(${LIB}/${c.n}) SRCFILE(${LIB}/QDDSSRCJ) SRCMBR(${c.n}) REPLACE(*YES)`);
    const kept = got.replace(/ +$/u, "") === line.replace(/ +$/u, "");
    console.log(
      `${c.n} ${c.why}\n   書いた JS ${line.length} 桁 / 読み戻し JS ${got.replace(/ +$/u,"").length} 桁 / ` +
      `内容一致 ${kept ? "○" : "**×**"} / コンパイル ${r.success ? "通る" : "通らない"}`
    );
    if (!kept) console.log("   読み戻し:", JSON.stringify(got.replace(/ +$/u, "")));
    if (r.success) await cmd.run(`DLTF FILE(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QDDSSRCJ) MBR(${c.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${c.n}.dds')`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${c.n}.back')`);
  }
} finally { cmd.close(); }
