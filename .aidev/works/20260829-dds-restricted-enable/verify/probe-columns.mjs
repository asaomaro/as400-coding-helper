#!/usr/bin/env node
/**
 * **項目レベルの 1 文字欄を、全 37 文字で網羅して確かめる。**
 *
 * `restricted: true` を立てるには「列挙が正しい」だけでなく**「漏れが無い」**ことが要る。
 * 列挙された値だけ試しても漏れは分からない。1 文字の欄は空間が 37 通り
 * （ブランク ＋ A-Z ＋ 0-9）なので、**全部試せば完全性が決まる**。
 *
 * 1 通りずつコンパイルすると 37 回かかるので、**1 つのソースに 37 項目を並べて 1 回**で流す。
 * リストは行ごとに指摘を出すので、項目と指摘を突き合わせられる。
 *
 * **リストは 2 部構成**（ソース → 展開後ソース）。後半にも項目名が出るので、
 * **最初に現れた方だけ**を採る（後半で上書きすると全部「指摘なし」になる）。
 *
 * 17 桁目（仕様のタイプ）は対象外。値を変えると**行の種類そのものが変わり**、
 * 構造の誤りが波及して 1 文字の判定にならない。
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
const SPACE = [" ", ...("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""))];
const pad3 = n => `  ${n}`.slice(-3);

/** 項目 1 つ。`column` の値だけを差し替える。他の欄は「通ると分かっている形」に固定。 */
function field(name, column, ch, row) {
  const base = [[19, name], [30, "   10"], [35, "A"]];
  if (row !== undefined) base.push([39, pad3(row)], [42, "  2"]);   // 画面/帳票は位置が要る
  const at = base.filter(([c]) => c !== column);
  return A(...at, ...(ch === " " ? [] : [[column, ch]]));
}

const TARGETS = [
  { key: "D35", type: "DSPF", column: 35, crt: "CRTDSPF", positioned: true },
  { key: "P35", type: "PF",   column: 35, crt: "CRTPF",   positioned: false },
  { key: "P38", type: "PF",   column: 38, crt: "CRTPF",   positioned: false },
  { key: "R35", type: "PRTF", column: 35, crt: "CRTPRTF", positioned: true }
];

function build(target) {
  const lines = [];
  const map = [];
  SPACE.forEach((ch, i) => {
    const per = target.positioned ? 19 : 37;
    if (i % per === 0) lines.push(A([17, "R"], [19, `REC${Math.floor(i / per)}`]));
    const name = `F${String(i).padStart(2, "0")}`;
    lines.push(field(name, target.column, ch, target.positioned ? (i % per) + 1 : undefined));
    map.push({ ch, name });
  });
  return { source: lines.join("\n") + "\n", map };
}

const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try {
  for (const t of TARGETS) await ifs.writeFile(`${IFS}/${t.key}.dds`, new TextEncoder().encode(build(t).source), { create: true, truncate: true });
} finally { ifs.close(); }

const db = await DbConnection.connect({ ...creds, resolvePort: true });
const printer = await NetPrintConnection.connect({ ...creds, resolvePort: true });
const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
const out = {};
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPDDS) RCDLEN(112)`);
  for (const t of TARGETS) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${t.key}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPDDS.FILE/${t.key}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QTMPDDS) MBR(${t.key}) SRCTYPE(${t.type})`);
    const r = await cmd.run(`${t.crt} FILE(${LIB}/${t.key}) SRCFILE(${LIB}/QTMPDDS) SRCMBR(${t.key}) REPLACE(*YES)`);

    const q = await query(db, `SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
      WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME = '${t.key}'
      ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 1 ROWS ONLY`);
    const sp = q.rows?.[0];
    let text = "";
    if (sp) {
      const [jobNumber, jobUser, jobName] = String(sp.JOB_NAME).split("/");
      const pages = await printer.readSpooledPages({ fileName: sp.SPOOLED_FILE_NAME, fileNumber: sp.FILE_NUMBER, jobName, jobUser, jobNumber });
      text = pages.flatMap(p => (p.lines ?? p.rows ?? []).map(l => (typeof l === "string" ? l : l.text ?? ""))).join("\n");
      await cmd.run(`DLTSPLF FILE(${sp.SPOOLED_FILE_NAME}) JOB(${sp.JOB_NAME}) SPLNBR(${sp.FILE_NUMBER})`).catch(() => {});
    }
    writeFileSync(join(HERE, `exhaustive-${t.key}.txt`), text);
    out[t.key] = { created: r.success, lines: text.split("\n").length };
    console.log(`${t.key} (${t.type} ${t.column}桁) 作成=${r.success ? "○" : "×"} リスト ${text.split("\n").length} 行`);
    if (r.success) await cmd.run(`DLTF FILE(${LIB}/${t.key})`);
    await cmd.run(`RMVM FILE(${LIB}/QTMPDDS) MBR(${t.key})`);
  }
  await cmd.run(`DLTF FILE(${LIB}/QTMPDDS)`);
} finally {
  cmd.close(); db.close(); printer.close();
  const clean = await IfsConnection.connect({ ...creds, resolvePort: true });
  try { for (const t of TARGETS) await clean.deleteFile(`${IFS}/${t.key}.dds`).catch(() => {}); } finally { clean.close(); }
}
console.log(JSON.stringify(out));
