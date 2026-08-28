// **Phase A: 土台づくり。** F/O/E/L の各仕様について「通る最小形」を先に確かめる。
// 前 work の教訓: 土台が無いまま変種を流すと、桁ではない失敗を切り分けることに時間を使う。
// ここは **全件 expect: true**。1 件でも落ちたらその形が誤っており、変種には進まない。
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
const at = (s, ...pairs) => pairs.reduce((l, [c, v]) => put(l, c, v), spec(s));

// --- 前 work で通ることを確かめた土台（そのまま使う） ---
const fIn   = () => at("F", [7, "INFILE"], [15, "I"], [16, "P"], [19, "F"], [24, "  80"], [40, "DISK"]);
const iRec  = () => at("I", [7, "INFILE"], [15, "NS"], [19, "01"]);
const iFld  = () => at("I", [44, "   1"], [48, "  10"], [53, "NAME"]);
const END   = at("C", [28, "SETON"], [54, "LR"]);

// --- 新しく組む土台 ---
/** 印刷ファイル: 種別 15=O / 形式 19=F / レコード長 24-27 / オーバーフロー 33-34 / 装置 40-46 */
const fPrint = (extra = []) => at("F", [7, "PRINT"], [15, "O"], [19, "F"], [24, " 132"], [33, "OF"], [40, "PRINTER"], ...extra);
/** 索引つき入力: レコードアドレス長 29-30 / 種別 31 / 編成 32 / キー開始 35-38 */
const fKeyed = () => at("F", [7, "IXFILE"], [15, "I"], [16, "P"], [19, "F"], [24, "  80"],
                        [29, " 5"], [31, "A"], [32, "I"], [35, "   1"], [40, "DISK"]);
const oRec  = () => at("O", [7, "PRINT"], [15, "D"], [18, "1"]);
const oFld  = () => at("O", [32, "NAME"], [40, "  30"]);
/** コンパイル時テーブル: 名前 27-32 / レコードあたり 33-35 / 表あたり 36-39 / 長さ 40-42 */
const eTab  = () => at("E", [27, "TAB1"], [33, "  1"], [36, "   3"], [40, "  3"]);
const tabData = ["**", "AAA", "BBB", "CCC"];
/** 行カウンター: 行 15-17 / チャネル 18-19 */
const lLine = () => at("L", [7, "PRINT"], [15, " 60"], [18, "FL"], [20, " 66"], [23, "OL"]);

const CASES = [
  { n: "A1", why: "土台: 入力 DISK ＋ SETON（前 work で確認済みの形）",
    src: [fIn(), iRec(), iFld(), END] },
  { n: "A2", why: "土台: 索引つき入力（レコードアドレス長 29-30・種別 31・編成 32・キー開始 35-38）",
    src: [fKeyed(), at("I", [7, "IXFILE"], [15, "NS"], [19, "01"]), iFld(), END] },
  { n: "A3", why: "土台: 印刷ファイル ＋ O 仕様（レコード 15/18・フィールド 32-37/40-43）",
    src: [fIn(), fPrint(), iRec(), iFld(), END, oRec(), oFld()] },
  { n: "A4", why: "土台: E 仕様のコンパイル時テーブル（27-32 / 33-35 / 36-39 / 40-42）",
    src: [fIn(), eTab(), iRec(), iFld(), END, ...tabData] },
  { n: "A5", why: "土台: L 仕様の行カウンター（F 仕様 39 桁目 `L` ＋ 行 15-17 / チャネル 18-19）",
    src: [fIn(), fPrint([[39, "L"]]), lLine(), iRec(), iFld(), END, oRec(), oFld()] },
  { n: "A0", why: "対照の対照: **存在しない命令**（これが通るなら判定そのものが壊れている）",
    src: [fIn(), iRec(), iFld(), at("C", [28, "ZZZZZ"]), END], expect: false }
];

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const x of CASES) await ifs.writeFile(`${IFS}/${x.n}.rpg`, new TextEncoder().encode(x.src.join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }
const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
let bad = 0;
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPSRC) RCDLEN(112)`);
  for (const x of CASES) {
    const expect = x.expect ?? true;
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${x.n}.rpg') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPSRC.FILE/${x.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QTMPSRC) MBR(${x.n}) SRCTYPE(RPG)`);
    const r = await cmd.run(`CRTRPGPGM PGM(${LIB}/${x.n}) SRCFILE(${LIB}/QTMPSRC) SRCMBR(${x.n}) REPLACE(*YES)`);
    const ok = r.success === expect;
    if (!ok) bad += 1;
    console.log(`${ok ? "期待どおり" : "**食い違う**"} ${x.n} ${r.success ? "通る" : "通らない"} — ${x.why}`);
    if (r.success) await cmd.run(`DLTPGM PGM(${LIB}/${x.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QTMPSRC) MBR(${x.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${x.n}.rpg')`);
  }
  await cmd.run(`DLTF FILE(${LIB}/QTMPSRC)`);
} finally { cmd.close(); }
process.exit(bad === 0 ? 0 : 1);
