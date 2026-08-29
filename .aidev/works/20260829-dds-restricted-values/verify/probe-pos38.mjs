#!/usr/bin/env node
/**
 * **表示装置ファイルの 38 桁目（使用目的）に何が入るかを実機に判定させる。**
 *
 * 原典が日英で食い違っている:
 *   ja `FIELD-DSPF-pos38.html` … 「**ブランクまたは 0**」（数字のゼロ）
 *   en `FIELD-DSPF-pos38.html` … 「**Blank or O**」（英字のオー）
 * さらに実サンプル `docs/src/CUSTMNT.dspf` は 38 桁目に `O` を使っている。
 *
 * AGENTS.md「原典と実機が食い違ったら、実機のパーサーに判定させる」。
 *
 * 判定は `CRTDSPF` の成否とメッセージ。**対照を先頭と末尾に置く**
 * （通ると分かっている `B` と、明らかに無効な `Q`）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const TS5250 = "/workspaces/ts5250";
const { CommandConnection, IfsConnection, DbConnection, query, NetPrintConnection } =
  await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;

const put = (l, c, v) => { const a = l.padEnd(80).split(""); for (let i = 0; i < v.length; i += 1) a[c - 1 + i] = v[i]; return a.join("").replace(/ +$/u, ""); };
const at = (...p) => p.reduce((l, [c, v]) => put(l, c, v), put(" ".repeat(80), 6, "A"));

/** 最小の画面ファイル。38 桁目（使用目的）だけを差し替える。 */
const source = usage => [
  at([17, "R"], [19, "REC1"]),
  at([19, "FLD1"], [30, "   10"], [35, "A"], ...(usage ? [[38, usage]] : []), [39, "  2"], [42, "  2"])
].join("\n") + "\n";

// 原典（日英）に出る値 ＋ 対照。
const CASES = [
  { n: "P00", v: "B", kind: "対照", expect: true },   // 入出力共用。通ると分かっている
  { n: "P01", v: "Q", kind: "対照", expect: false },  // 原典のどこにも無い
  { n: "P02", v: "",  kind: "候補" },                  // ブランク（日英とも有効）
  { n: "P03", v: "0", kind: "候補" },                  // **ja の「ブランクまたは 0」**
  { n: "P04", v: "O", kind: "候補" },                  // **en の「Blank or O」/ CUSTMNT.dspf**
  { n: "P05", v: "I", kind: "候補" },
  { n: "P06", v: "H", kind: "候補" },
  { n: "P07", v: "M", kind: "候補" },
  { n: "P08", v: "P", kind: "候補" },
  { n: "P09", v: "B", kind: "対照(末尾)", expect: true },
  { n: "P10", v: "Q", kind: "対照(末尾)", expect: false }
];

const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const c of CASES) await ifs.writeFile(`${IFS}/${c.n}.dspf`, new TextEncoder().encode(source(c.v)), { create: true, truncate: true }); }
finally { ifs.close(); }

const db = await DbConnection.connect({ ...creds, resolvePort: true });
const printer = await NetPrintConnection.connect({ ...creds, resolvePort: true });
const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
const results = [];
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPDDS) RCDLEN(112)`);
  for (const c of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.n}.dspf') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPDDS.FILE/${c.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QTMPDDS) MBR(${c.n}) SRCTYPE(DSPF)`);
    const r = await cmd.run(`CRTDSPF FILE(${LIB}/${c.n}) SRCFILE(${LIB}/QTMPDDS) SRCMBR(${c.n}) REPLACE(*YES)`);

    // **スプール名は対象の名前**（QDDSLST ではない）。取り違えると 0 件で
    // 「メッセージなし＝正しい」と誤読する。
    let codes = [];
    const q = await query(db, `SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
      WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME = '${c.n}'
      ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 1 ROWS ONLY`);
    const sp = q.rows?.[0];
    if (sp) {
      const [jobNumber, jobUser, jobName] = String(sp.JOB_NAME).split("/");
      const pages = await printer.readSpooledPages({ fileName: sp.SPOOLED_FILE_NAME, fileNumber: sp.FILE_NUMBER, jobName, jobUser, jobNumber });
      const text = pages.flatMap(p => (p.lines ?? p.rows ?? []).map(l => (typeof l === "string" ? l : l.text ?? ""))).join("\n");
      codes = [...new Set([...text.matchAll(/CP[DF]\d{4}|CPD\d{4}/gu)].map(m => m[0]))].sort();
      await cmd.run(`DLTSPLF FILE(${sp.SPOOLED_FILE_NAME}) JOB(${sp.JOB_NAME}) SPLNBR(${sp.FILE_NUMBER})`).catch(() => {});
    }
    results.push({ ...c, created: r.success, codes });
    const mark = c.expect !== undefined && c.expect !== r.success ? "  ← **対照が食い違う**" : "";
    console.log(`${c.n} 38桁=${(c.v || "(空白)").padEnd(6)} ${c.kind.padEnd(10)} 作成=${r.success ? "○" : "×"} ${codes.join(",")}${mark}`);
    if (r.success) await cmd.run(`DLTF FILE(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QTMPDDS) MBR(${c.n})`);
  }
  await cmd.run(`DLTF FILE(${LIB}/QTMPDDS)`);
} finally {
  cmd.close(); db.close(); printer.close();
  const clean = await IfsConnection.connect({ ...creds, resolvePort: true });
  try { for (const c of CASES) await clean.deleteFile(`${IFS}/${c.n}.dspf`).catch(() => {}); } finally { clean.close(); }
}

writeFileSync(join(HERE, "pos38-result.json"), JSON.stringify(results, null, 1) + "\n");
const controls = results.filter(r => r.expect !== undefined);
const bad = controls.filter(r => r.created !== r.expect);
console.log(`\n対照 ${controls.length} 件中 ${controls.length - bad.length} 件が期待どおり`);
if (bad.length) { console.error("**対照が外れた。結果を採らない。**"); process.exit(1); }
console.log("実機が受ける:", results.filter(r => r.kind === "候補" && r.created).map(r => r.v || "(空白)").join(" "));
console.log("実機が弾く  :", results.filter(r => r.kind === "候補" && !r.created).map(r => r.v || "(空白)").join(" ") || "なし");
