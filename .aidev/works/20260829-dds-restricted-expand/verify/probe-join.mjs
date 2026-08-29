#!/usr/bin/env node
/**
 * **38 桁目の残り 1 文脈——結合論理ファイル（JFILE）。**
 *
 * 原典（`FIELD-PF-lfusg.html`）は 38 桁目の有効な値を**文脈で分けている**:
 *
 * | 文脈 | 原典 |
 * |---|---|
 * | 物理ファイル | ブランク / B |
 * | 論理ファイル | ブランク / B / I / N |
 * | └ うち `N` | 「このフィールドは、**結合論理ファイルの場合にだけ有効です**」 |
 * | └ うち `B` | 「**結合論理ファイル**は読み取り専用ファイルであるため、…入出力共用フィールドを指定することはできません」 |
 *
 * 実測: `CRTPF` は `_B`、`PFILE` の単純論理は `_BI`。**`N` はどちらでも落ちた**。
 * 定義（`_BIN`）が正しいかどうかは、結合論理を測らないと決まらない。
 *
 * 判定は他と同じ——`CPD7410@38` が付いたら無効。**雛形が壊れていれば
 * どの文字にも印が付かない**ので、印がゼロなら結果を採らない（内蔵の対照）。
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
const B1 = "XJNA", B2 = "XJNB";

const base1 = [A([17, "R"], [19, "RA"]), ...NAMES.map(n => A([19, n], [30, "   10"], [35, "A"]))].join("\n") + "\n";
const base2 = [A([17, "R"], [19, "RB2"]), A([19, "G00"], [30, "   10"], [35, "A"])].join("\n") + "\n";

/** 結合論理の頭（様式 ＋ J 仕様 ＋ 結合条件）。**J 仕様は様式の直後**に置く。 */
const JOIN_HEAD = [
  A([17, "R"], [19, "RJ"], [45, `JFILE(${LIB}/${B1} ${LIB}/${B2})`]),
  A([17, "J"], [45, "JOIN(1 2)"]),
  A([45, "JFLD(F00 G00)"])
];

/** 38 桁: 項目ごとに使用目的を変える。 */
const joinSource = [...JOIN_HEAD,
  ...SPACE.map((ch, i) => A([19, NAMES[i]], ...(ch === " " ? [] : [[38, ch]])))].join("\n") + "\n";

/**
 * 17 桁: 結合論理でも測る。**物理と単純論理で同じ集合が出たからといって
 * 結合論理も同じとは限らない**——現に 38 桁は 3 文脈で全部違った。
 * 印刷装置が `H` を受けて物理が受けないように、17 桁の判定も種別で変わる。
 */
const joinTypeSource = [...JOIN_HEAD, A([19, NAMES[0]]),
  ...SPACE.map(ch => A(...(ch === " " ? [] : [[17, ch]]), [19, NAMES[0]]))].join("\n") + "\n";

if (process.argv.includes("--dry")) {
  for (const [n, s] of [["38 桁", joinSource], ["17 桁", joinTypeSource]]) {
    console.log(`\n===== 結合論理 ${n} 行=${s.trimEnd().split("\n").length} =====`);
    console.log(s.trimEnd().split("\n").slice(0, 7).join("\n") + "\n   …");
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
  await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${name}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPJN.FILE/${name}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await cmd.run(`CHGPFM FILE(${LIB}/QTMPJN) MBR(${name}) SRCTYPE(${srcType})`);
  const since = new Date(Date.now() - 5000).toISOString().slice(0, 19).replace("T", " ");
  await cmd.run(`DLTF FILE(${LIB}/${name})`).catch(() => {});
  const r = await cmd.run(`${crt} FILE(${LIB}/${name}) SRCFILE(${LIB}/QTMPJN) SRCMBR(${name})`);
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

let out = {};
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPJN) RCDLEN(112)`);
  for (const [n, s] of [[B1, base1], [B2, base2]]) {
    const r = await compile(n, "PF", "CRTPF", s);
    console.log(`土台 ${n} 作成=${r.created ? "○" : "×"}`);
    if (!r.created) { for (const m of r.messages) console.log(`     ${m.slice(0, 100)}`); throw new Error("土台が作れない。結果を採らない。"); }
  }

  for (const t of [{ key: "XJN38", column: 38, source: joinSource, skip: 0 },
                   { key: "XJN17", column: 17, source: joinTypeSource, skip: 1 }]) {
    const { created, messages, listing } = await compile(t.key, "LF", "CRTLF", t.source);
    writeFileSync(join(HERE, `join-${t.key}.txt`), listing);
    const bodies = parseListing(listing).filter(r => !/\sR\s+RJ|\sJ\s{2,}|JFLD\(/u.test(r.text));
    const verdict = {};
    SPACE.forEach((ch, i) => {
      const row = bodies[i + t.skip];
      if (!row) { verdict[ch] = { v: "行なし" }; return; }
      const bad = row.marks.some(m => m.column === t.column && INVALID.has(m.id));
      verdict[ch] = { v: bad ? "無効" : "受理", marks: row.marks.map(m => `${m.id}@${m.column}`), text: row.text.trim() };
    });
    const accepted = Object.entries(verdict).filter(([, x]) => x.v === "受理").map(([c]) => c);
    const flagged = Object.values(verdict).filter(x => x.v === "無効").length;
    out[t.key] = { column: t.column, created, messages, verdict, accepted, rows: bodies.length, flagged };
    console.log(`${t.key} 結合論理 ${t.column}桁  行 ${bodies.length}  受理 ${accepted.length}: ${accepted.map(c => c === " " ? "_" : c).join("")}`);
    // **内蔵の対照**: 印が 1 つも付かなければ、雛形がその桁まで到達していない。
    console.log(flagged === 0 ? "  ! 印が 1 つも付いていない → **雛形が壊れている。結果を採らない**" : `  印が付いた文字 ${flagged} 件（雛形は ${t.column} 桁まで到達している）`);
    for (const m of messages) console.log(`     ${m.slice(0, 100)}`);
  }

  for (const n of ["XJN38", "XJN17", B1, B2]) await cmd.run(`DLTF FILE(${LIB}/${n})`).catch(() => {});
  await cmd.run(`DLTF FILE(${LIB}/QTMPJN)`);
} finally { cmd.close(); db.close(); printer.close(); }

writeFileSync(join(HERE, "join-report.json"), JSON.stringify({ out, spools }, null, 2));
console.log(`\n**残したスプール** ${spools.length} 件`);
for (const s of spools) console.log(`  ${s}`);
