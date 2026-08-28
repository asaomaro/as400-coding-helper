#!/usr/bin/env node
/**
 * F 仕様 継続行の「選択」欄(54-59)に入る語を **実機のコンパイラに判定させる**。
 *
 * ## 前回の失敗を繰り返さない
 *
 * `20260828-rpg3-fspec-continuation` は**作成の成否**で判別し、通ったのが `INFDS` だけに
 * なった。しかし `INFSR` のリストは `QRG2075`（記入が不正）で、**語自体は有効**だった。
 * 成否で見ると「語が無効」と「記入が違う」が区別できない。
 *
 * **判別はメッセージの種類で行う:**
 *   QRG2023 … 選択(54-59)の語が無効
 *   QRG2075 … 語は有効・記入(60-65)がその語に合わない
 *   どちらも無く作成できた … 語も記入も有効
 *
 * これなら**語ごとの正しい記入を用意しなくてよい**（30 件ぶんの仕掛けが要らない）。
 *
 * ## 対照
 *
 * 先頭と末尾に対照を置く。`INFDS`（前 work で通ることを確認済み）と `ZZZZZZ`（存在しない語）。
 * **対照が期待どおりでなければ手法が壊れている**ので結果を採らない。
 *
 * 実行: cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify <このファイル>
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS5250 = process.env.TS5250_ROOT ?? "/workspaces/ts5250";
for (const p of [join(TS5250, "packages/hostserver/dist/index.js"), join(TS5250, "profiles.local.json")]) {
  if (!existsSync(p)) { console.error(`前提が足りません: ${p}`); process.exit(2); }
}
const { CommandConnection, IfsConnection, DbConnection, query, NetPrintConnection } =
  await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));

const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;

// --- 固定長の組み立て（前 work と同じ） -------------------------------------
const put = (l, c, v) => { const a = l.padEnd(80).split(""); for (let i = 0; i < v.length; i += 1) a[c - 1 + i] = v[i]; return a.join("").replace(/ +$/u, ""); };
const at = (s, ...p) => p.reduce((l, [c, v]) => put(l, c, v), put(" ".repeat(80), 6, s));

const fIn  = () => at("F", [7, "INFILE"], [15, "I"], [16, "P"], [19, "F"], [24, "  80"], [40, "DISK"]);
const iRec = () => at("I", [7, "INFILE"], [15, "NS"], [19, "01"]);
const iFld = () => at("I", [44, "   1"], [48, "  10"], [53, "NAME"]);
const iDs  = () => [at("I", [7, "FDS"], [19, "DS"]), at("I", [44, "   1"], [48, "  80"], [53, "FDUMMY"])];
const END  = at("C", [28, "SETON"], [54, "LR"]);
/** 継続行。53=K / 54-59=選択 / 60-65=記入。 */
const cont = (opt, entry) => at("F", [53, "K"], [54, opt], ...(entry ? [[60, entry]] : []));

// 候補は PJ 内の原典由来データ（ILE の F 仕様キーワード 45 件のうち 6 桁に収まる 30 件）。
// **RPG III にしか無い語は取りこぼす**——限界として記録する（AC5）。
const CANDIDATES = JSON.parse(readFileSync(join(HERE, process.env.CAND_FILE ?? "candidates.json"), "utf8"));

// 記入は**全件共通のダミー**でよい。語ごとの正解を用意しなくても、
// QRG2023（語が無効）と QRG2075（記入が違う）で判別できる。
const ENTRY = "FDS";

const CASES = [
  { n: "K00", opt: "INFDS",  kind: "対照", expect: "有効" },
  { n: "K01", opt: "ZZZZZZ", kind: "対照", expect: "無効" },
  ...CANDIDATES.map((opt, i) => ({ n: `C${String(i).padStart(2, "0")}`, opt, kind: "候補" })),
  { n: "K98", opt: "INFDS",  kind: "対照(末尾)", expect: "有効" },
  { n: "K99", opt: "ZZZZZZ", kind: "対照(末尾)", expect: "無効" }
];

const source = opt => [fIn(), cont(opt, ENTRY), iRec(), iFld(), ...iDs(), END].join("\n") + "\n";

// --- 実機 --------------------------------------------------------------------
const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try {
  for (const c of CASES) {
    await ifs.writeFile(`${IFS}/${c.n}.rpg`, new TextEncoder().encode(source(c.opt)), { create: true, truncate: true });
  }
} finally { ifs.close(); }

const db = await DbConnection.connect({ ...creds, resolvePort: true });
const printer = await NetPrintConnection.connect({ ...creds, resolvePort: true });
const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });

/**
 * その回のコンパイル・リストを読んで、出ている QRGnnnn の集合を返す。
 *
 * **`CRTRPGPGM` のリストのスプール名は `QRPGLST` ではなくプログラム名**（実測）。
 * ここを取り違えると 1 件も見つからず、**「メッセージなし」＝有効と誤読する**
 * （実際に踏んだ。対照の `ZZZZZZ` が「有効」に見えて気付いた）。
 * 名前で引けるので、どのリストがどの回のものかも曖昧にならない。
 */
async function listingCodes(name) {
  const r = await query(db, `SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
    WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME = '${name}'
    ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 1 ROWS ONLY`);
  const spool = r.rows?.[0];
  if (!spool) return { codes: [], note: "スプールが見つからない" };
  const [jobNumber, jobUser, jobName] = String(spool.JOB_NAME).split("/");
  const pages = await printer.readSpooledPages({
    fileName: spool.SPOOLED_FILE_NAME, fileNumber: spool.FILE_NUMBER, jobName, jobUser, jobNumber
  });
  const text = pages.map(p => (p.lines ?? p.rows ?? [])
    .map(l => (typeof l === "string" ? l : l.text ?? "")).join("\n")).join("\n");
  const codes = [...new Set([...text.matchAll(/QRG(\d{4})/gu)].map(m => `QRG${m[1]}`))].sort();
  return { codes, spool: `${spool.JOB_NAME}#${spool.FILE_NUMBER}` };
}

const results = [];
let baseline = [];
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPSRC) RCDLEN(112)`);
  for (const c of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.n}.rpg') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPSRC.FILE/${c.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QTMPSRC) MBR(${c.n}) SRCTYPE(RPG)`);
    const r = await cmd.run(`CRTRPGPGM PGM(${LIB}/${c.n}) SRCFILE(${LIB}/QTMPSRC) SRCMBR(${c.n}) REPLACE(*YES) GENLVL(50)`);
    const { codes, spool } = await listingCodes(c.n);

    // 判別はメッセージの種類。成否では判別しない。
    // QRG2023 = 語が無効。それ以外のメッセージは「語は通ったが記入が合わない」ので有効。
    // **`r.success` では判別しない**——GENLVL(50) では重大度 30 でも作成されるため、
    // 成否を見ると `ZZZZZZ` まで「通った」ことになる（前回の誤りの原因）。
    const verdict = codes.includes("QRG2023") ? "無効" : "有効";

    // **基準の対照に出るメッセージは差し引く。** どのリストにも出る QRG7031 / QRG7086
    // （使われないファイル等）まで並べると、語に起因するものが埋もれる。
    if (c.n === "K00") baseline = codes;
    const extra = codes.filter(code => !baseline.includes(code));
    results.push({ ...c, created: r.success, codes, extra, verdict, spool });
    console.log(
      `${c.n} ${c.opt.padEnd(7)} ${c.kind.padEnd(10)} 作成=${r.success ? "○" : "×"} ` +
      `判定=${verdict.padEnd(5)} ${extra.join(",") || "(基準どおり)"}` +
      (c.expect && c.expect !== verdict ? `  ← **対照が期待(${c.expect})と食い違う**` : "")
    );

    if (r.success) await cmd.run(`DLTPGM PGM(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QTMPSRC) MBR(${c.n})`);
  }
  await cmd.run(`DLTF FILE(${LIB}/QTMPSRC)`);
} finally {
  cmd.close(); db.close(); printer.close();
  const clean = await IfsConnection.connect({ ...creds, resolvePort: true });
  try { for (const c of CASES) await clean.deleteFile(`${IFS}/${c.n}.rpg`).catch(() => {}); } finally { clean.close(); }
}

writeFileSync(join(HERE, process.env.OUT_FILE ?? "options-result.json"), JSON.stringify(results, null, 1) + "\n");

const controls = results.filter(r => r.expect);
const bad = controls.filter(r => r.verdict !== r.expect);
console.log(`\n対照 ${controls.length} 件中 ${controls.length - bad.length} 件が期待どおり`);
if (bad.length > 0) { console.error("**対照が外れた。手法が壊れているので結果を採らない。**"); process.exit(1); }
const valid = results.filter(r => r.kind === "候補" && r.verdict === "有効").map(r => r.opt);
const invalid = results.filter(r => r.kind === "候補" && r.verdict === "無効").map(r => r.opt);
console.log(`有効 ${valid.length} 件: ${valid.join(" ")}`);
console.log(`無効 ${invalid.length} 件: ${invalid.join(" ")}`);
// 語は通ったが別のメッセージが出たもの。**記入の形が語ごとに違う証拠**として残す。
const withEntryError = results.filter(r => r.kind === "候補" && r.verdict === "有効" && r.extra.length > 0);
console.log(`うち記入に関する指摘が出たもの ${withEntryError.length} 件:`);
for (const r of withEntryError) console.log(`  ${r.opt.padEnd(7)} ${r.extra.join(",")}`);
