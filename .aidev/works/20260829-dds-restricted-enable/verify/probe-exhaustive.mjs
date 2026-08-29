#!/usr/bin/env node
/**
 * **1 文字の欄の値集合を「網羅」で確かめる。**
 *
 * `restricted: true` を立てるには「列挙が制限として正しい」だけでなく
 * **「漏れが無い」**ことが要る。列挙された値を試すだけでは漏れは分からない
 * （RPG III の継続行で踏んだ限界そのもの）。
 *
 * ただし**1 文字の欄なら空間は 37 通り**（A-Z / 0-9 / ブランク）。全部試せば
 * 完全性が決まる。**1 通りずつコンパイルすると 37 回**かかるので、
 * **1 つのソースに 37 項目を並べて 1 回で流す**（リストは行ごとに指摘を出す）。
 *
 * 判定はメッセージ番号。「値が無効」と「認識はされたが文脈違い」を読み分ける。
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
const A = (...p) => p.reduce((l, [c, v]) => put(l, c, v), put(" ".repeat(80), 6, "A"));

/** 1 文字の欄の全空間。 */
const SPACE = [" ", ...("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""))];

/**
 * 表示装置ファイルの 38 桁目（使用目的）を全 37 通り試す。
 * 1 レコードに 19 項目まで（画面が 24 行なので行を分ける）。
 */
function dspfUsageSource() {
  const lines = [];
  const map = [];
  SPACE.forEach((ch, i) => {
    const rec = Math.floor(i / 19);
    const row = (i % 19) + 1;
    if (i % 19 === 0) lines.push(A([17, "R"], [19, `REC${rec}`]));
    const name = `F${String(i).padStart(2, "0")}`;
    lines.push(A([19, name], [30, "   10"], [35, "A"], ...(ch === " " ? [] : [[38, ch]]), [39, `  ${row}`.slice(-3)], [42, "  2"]));
    map.push({ ch, name, line: lines.length }); // 1 始まりの行番号
  });
  return { source: lines.join("\n") + "\n", map };
}

const { source, map } = dspfUsageSource();
const NAME = "X38";

const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try { await ifs.writeFile(`${IFS}/${NAME}.dspf`, new TextEncoder().encode(source), { create: true, truncate: true }); }
finally { ifs.close(); }

const db = await DbConnection.connect({ ...creds, resolvePort: true });
const printer = await NetPrintConnection.connect({ ...creds, resolvePort: true });
const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
let text = "";
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPDDS) RCDLEN(112)`);
  await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${NAME}.dspf') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPDDS.FILE/${NAME}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await cmd.run(`CHGPFM FILE(${LIB}/QTMPDDS) MBR(${NAME}) SRCTYPE(DSPF)`);
  const r = await cmd.run(`CRTDSPF FILE(${LIB}/${NAME}) SRCFILE(${LIB}/QTMPDDS) SRCMBR(${NAME}) REPLACE(*YES)`);
  console.log("作成:", r.success ? "○" : "×");

  const q = await query(db, `SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
    WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME = '${NAME}'
    ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 1 ROWS ONLY`);
  const sp = q.rows?.[0];
  if (sp) {
    const [jobNumber, jobUser, jobName] = String(sp.JOB_NAME).split("/");
    const pages = await printer.readSpooledPages({ fileName: sp.SPOOLED_FILE_NAME, fileNumber: sp.FILE_NUMBER, jobName, jobUser, jobNumber });
    text = pages.flatMap(p => (p.lines ?? p.rows ?? []).map(l => (typeof l === "string" ? l : l.text ?? ""))).join("\n");
    await cmd.run(`DLTSPLF FILE(${sp.SPOOLED_FILE_NAME}) JOB(${sp.JOB_NAME}) SPLNBR(${sp.FILE_NUMBER})`).catch(() => {});
  }
  if (r.success) await cmd.run(`DLTF FILE(${LIB}/${NAME})`);
  await cmd.run(`RMVM FILE(${LIB}/QTMPDDS) MBR(${NAME})`);
  await cmd.run(`DLTF FILE(${LIB}/QTMPDDS)`);
} finally {
  cmd.close(); db.close(); printer.close();
  const clean = await IfsConnection.connect({ ...creds, resolvePort: true });
  try { await clean.deleteFile(`${IFS}/${NAME}.dspf`).catch(() => {}); } finally { clean.close(); }
}

writeFileSync(join(HERE, "exhaustive-38.txt"), text);
// リストは「行番号 … メッセージ番号」の形で指摘を出す。項目名で引く方が確実。
const found = new Map();
for (const m of text.matchAll(/(CPD\d{4})/gu)) found.set(m[1], (found.get(m[1]) ?? 0) + 1);
console.log("出たメッセージ:", [...found.entries()].map(([k, v]) => `${k}×${v}`).join(" "));
console.log("\n--- 項目ごと（リストの行から拾う）---");
for (const e of map) {
  const hit = text.split("\n").filter(l => l.includes(e.name));
  console.log(`${e.ch === " " ? "(空白)" : e.ch}  ${e.name}  ${hit.length ? hit.map(h => (h.match(/CPD\d{4}/gu) ?? []).join(",")).filter(Boolean).join(" ") || "(指摘なし)" : "(行なし)"}`);
}
