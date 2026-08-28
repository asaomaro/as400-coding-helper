// **RPG III の数値欄**を実機に判定させる。
// RPG/400 Reference が入手できないので原典照合ができない（backlog の起票どおり）。
// 見るのは 2 つ: 数字以外を弾くか / 右寄せを要求するか。
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
/** C 仕様（RPG III）: 演算 28-32 / 因子 2 33-42 / 結果 43-48 / 長さ 49-51 / 小数 52 */
const c = (op, f2, res, len, dec) => {
  let l = put(put(spec("C"), 28, op), 33, f2);
  if (res) l = put(l, 43, res);
  if (len !== undefined) l = put(l, len.col, len.text);
  if (dec !== undefined) l = put(l, 52, dec);
  return l;
};
// **SETON を書く**（最初は LR だけ置いて演算を忘れ、対照ごと落ちた）。
// RPG III の C 仕様: 演算 28-32 / 結果標識 54-55・56-57・58-59。
const END = put(put(spec("C"), 28, "SETON"), 54, "LR");

// **数値の結果フィールドには小数位置が要る**（実機で判明）。
// 最初は小数を省いた形を対照にして全部落ち、`Z-ADD` の相手が数値だからだと分かった。
// 以降は小数を必ず置き、**長さ欄の中身と寄せ方だけ**を変える。
const CASES = [
  { n: "N1", why: "対照: 長さ 51 桁（右寄せ）＋ 小数 0", src: [c("Z-ADD", "0", "TOTAL", { col: 51, text: "6" }, "0"), END], expect: true },
  { n: "N2", why: "**長さを 49 桁（左詰め）**に置く（実サンプルの書き方）", src: [c("Z-ADD", "0", "TOTAL", { col: 49, text: "6" }, "0"), END], expect: true },
  { n: "N3", why: "長さ 2 桁を 49-50（左詰め）", src: [c("Z-ADD", "0", "TOTAL", { col: 49, text: "12" }, "0"), END], expect: true },
  { n: "N4", why: "長さ 2 桁を 50-51（右寄せ）", src: [c("Z-ADD", "0", "TOTAL", { col: 50, text: "12" }, "0"), END], expect: true },
  { n: "N5", why: "**長さ欄に英字**（51 桁に `A`）", src: [c("Z-ADD", "0", "TOTAL", { col: 51, text: "A" }, "0"), END], expect: false },
  { n: "N6", why: "**小数欄に英字**（52 桁に `A`）", src: [c("Z-ADD", "0", "TOTAL", { col: 51, text: "6" }, "A"), END], expect: false },
  { n: "N7", why: "長さ欄に**空白を挟んだ数字**（49 桁に `1`・51 桁に `2`）", src: [put(c("Z-ADD", "0", "TOTAL", { col: 49, text: "1" }, "0"), 51, "2"), END], expect: false }
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
