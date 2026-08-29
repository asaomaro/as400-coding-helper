#!/usr/bin/env node
/**
 * **物理/論理の欄を「論理ファイル」でも確かめる。**
 *
 * `DDS-PF.json` は `.pf`（物理）と `.lf`（論理）の**両方**を担うが、
 * **原典は 38 桁目で値集合を分けている**（`FIELD-PF-lfusg.html`）:
 *
 * > 物理ファイルの場合に指定できる項目は次のとおりです。 ブランク / B
 * > 論理ファイルに有効な項目は… ブランク / B / **I (入力専用)** / **N (非入出力)**
 *
 * `CRTPF` だけで測ると物理の集合しか出ない（実際 `I` `N` が `CPD7410@38` で落ちた）。
 * **定義の集合は両者の和**なので、和を確かめるには `CRTLF` も要る。
 *
 * 17 桁も同じ理由で確かめる（`S`/`O`/`J` は論理ファイル専用の仕様）。
 * 物理で測った集合が定義と一致していても、**論理で余分な値が通れば不一致**になる。
 *
 * 手順: 土台の物理ファイルを 1 つ作り、その上に論理ファイルを重ねる。
 * 論理ファイルの項目は土台に無い名前を書けないので、土台に 37 項目を用意する。
 *
 * スプールは消さない（spec D9）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseListing } from "./parse-listing.mjs";

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
const INVALID = new Set(["CPD7410", "CPD7419"]);
const NAMES = SPACE.map((_, i) => `F${String(i).padStart(2, "0")}`);
const BASE = "XLFB";

/** 土台の物理ファイル。論理ファイルが参照する項目をすべて持たせる。 */
const baseSource = [A([17, "R"], [19, "RB"]), ...NAMES.map(n => A([19, n], [30, "   10"], [35, "A"]))].join("\n") + "\n";

/** 38 桁: 項目ごとに使用目的を変えた論理ファイル。 */
const usageSource = [A([17, "R"], [19, "RB"], [45, `PFILE(${LIB}/${BASE})`]),
  ...SPACE.map((ch, i) => A([19, NAMES[i]], ...(ch === " " ? [] : [[38, ch]])))].join("\n") + "\n";

/** 17 桁: 有効な項目を 1 つ置いてから、17 桁だけを変えた行を並べる。 */
const typeSource = [A([17, "R"], [19, "RB"], [45, `PFILE(${LIB}/${BASE})`]), A([19, NAMES[0]]),
  ...SPACE.map(ch => A(...(ch === " " ? [] : [[17, ch]]), [19, NAMES[0]]))].join("\n") + "\n";

if (process.argv.includes("--dry")) {
  for (const [n, s] of [["土台 PF", baseSource], ["LF 38 桁", usageSource], ["LF 17 桁", typeSource]]) {
    console.log(`\n===== ${n} 行=${s.trimEnd().split("\n").length} =====`);
    console.log(s.trimEnd().split("\n").slice(0, 4).join("\n") + "\n   …");
  }
  process.exit(0);
}

const db = await DbConnection.connect({ ...creds, resolvePort: true });
const printer = await NetPrintConnection.connect({ ...creds, resolvePort: true });
const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
const spools = [];

async function compile(name, srcType, crt, source) {
  const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
  try { await ifs.writeFile(`${IFS}/${name}.dds`, new TextEncoder().encode(source), { create: true, truncate: true }); }
  finally { ifs.close(); }
  await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${name}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPLF.FILE/${name}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await cmd.run(`CHGPFM FILE(${LIB}/QTMPLF) MBR(${name}) SRCTYPE(${srcType})`);
  const since = new Date(Date.now() - 5000).toISOString().slice(0, 19).replace("T", " ");
  // **CRTPF / CRTLF に REPLACE は無い**（CPD0043）。場所を空けてから作る。
  await cmd.run(`DLTF FILE(${LIB}/${name})`).catch(() => {});
  const r = await cmd.run(`${crt} FILE(${LIB}/${name}) SRCFILE(${LIB}/QTMPLF) SRCMBR(${name})`);
  const q = await query(db, `SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
    WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME = '${name}'
      AND CREATE_TIMESTAMP >= TIMESTAMP('${since}') ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 1 ROWS ONLY`);
  const sp = q.rows?.[0];
  let listing = "";
  if (sp) {
    const [jobNumber, jobUser, jobName] = String(sp.JOB_NAME).split("/");
    const pages = await printer.readSpooledPages({ fileName: name, fileNumber: sp.FILE_NUMBER, jobName, jobUser, jobNumber });
    listing = pages.flatMap(p => (p.lines ?? p.rows ?? []).map(l => (typeof l === "string" ? l : l.text ?? ""))).join("\n");
    spools.push(`${name} #${sp.FILE_NUMBER} ${sp.JOB_NAME}`);
  }
  const ifs2 = await IfsConnection.connect({ ...creds, resolvePort: true });
  try { await ifs2.deleteFile(`${IFS}/${name}.dds`).catch(() => {}); } finally { ifs2.close(); }
  return { created: r?.success ?? false, messages: (r?.messages ?? []).map(m => `${m.id} ${m.text}`), listing };
}

const out = {};
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPLF) RCDLEN(112)`);

  // 土台。**これが作れなければ以降の結果は採らない**（対照）。
  const base = await compile(BASE, "PF", "CRTPF", baseSource);
  console.log(`土台 ${BASE} 作成=${base.created ? "○" : "×"}`);
  for (const m of base.messages) console.log(`     ${m.slice(0, 100)}`);
  if (!base.created) throw new Error("土台の物理ファイルが作れない。結果を採らない。");

  for (const t of [{ key: "XLF38", column: 38, source: usageSource, skip: 0 },
                   { key: "XLF17", column: 17, source: typeSource, skip: 1 }]) {
    const { created, listing } = await compile(t.key, "LF", "CRTLF", t.source);
    writeFileSync(join(HERE, `logical-${t.key}.txt`), listing);
    const bodies = parseListing(listing).filter(r => !/\sR\s+RB/u.test(r.text));
    const verdict = {};
    SPACE.forEach((ch, i) => {
      const row = bodies[i + t.skip];
      if (!row) { verdict[ch] = { v: "行なし" }; return; }
      const bad = row.marks.some(m => m.column === t.column && INVALID.has(m.id));
      verdict[ch] = { v: bad ? "無効" : "受理", marks: row.marks.map(m => `${m.id}@${m.column}`), text: row.text.trim() };
    });
    const accepted = Object.entries(verdict).filter(([, x]) => x.v === "受理").map(([c]) => c);
    out[t.key] = { column: t.column, created, verdict, accepted, rows: bodies.length };
    console.log(`${t.key} 論理 ${t.column}桁  行 ${bodies.length}  受理 ${accepted.length}: ${accepted.map(c => c === " " ? "_" : c).join("")}`);
  }

  await cmd.run(`DLTF FILE(${LIB}/XLF38)`).catch(() => {});
  await cmd.run(`DLTF FILE(${LIB}/XLF17)`).catch(() => {});
  await cmd.run(`DLTF FILE(${LIB}/${BASE})`).catch(() => {});
  await cmd.run(`DLTF FILE(${LIB}/QTMPLF)`);
} finally { cmd.close(); db.close(); printer.close(); }

writeFileSync(join(HERE, "logical-report.json"), JSON.stringify({ out, spools }, null, 2));
console.log(`\n**残したスプール** ${spools.length} 件`);
for (const s of spools) console.log(`  ${s}`);
