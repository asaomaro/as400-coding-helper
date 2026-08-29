#!/usr/bin/env node
/**
 * **印刷装置 38 桁（使用目的）の値集合を全 37 通りで確かめる。**
 *
 * 原典は ブランク / `O`（出力専用）/ `P`（プログラム - システム間）の 3 つを挙げる。
 * 漏れが無いかは網羅でしか決まらない。
 *
 * 判定は**メッセージ番号 ＋ 印が指す桁**（`CPD7419` / `CPD7410` が無効）。
 * 解析器は前作業のものを**再利用する**——写しを作ると、リストの 2 部構成と
 * ページ境界の罠を二度踏む（`20260829-dds-restricted-expand` の research F3）。
 *
 * **`P` は位置欄を持てない**（原典「位置は無効です」）ので、位置を書いた雛形では
 * `P` の行が別の理由で落ちる。判定は 38 桁の印だけを見るので影響しない。
 * 念のため**位置ありと位置なしの両方**を流して突き合わせる。
 *
 * スプールは消さない（`20260829-dds-restricted-expand` の decisions D1）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseListing } from "../../20260829-dds-restricted-expand/verify/parse-listing.mjs";

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
const pad3 = n => `  ${n}`.slice(-3);

/** 位置あり / 位置なしの 2 通り。`P` は原典が「位置は無効」と言うため。 */
function build(positioned) {
  const lines = [];
  SPACE.forEach((ch, i) => {
    if (i % 19 === 0) lines.push(A([17, "R"], [19, `REC${Math.floor(i / 19)}`]));
    const base = [[19, `F${String(i).padStart(2, "0")}`], [30, "   10"], [35, "A"]];
    if (positioned) base.push([39, pad3((i % 19) + 1)], [42, "  2"]);
    lines.push(A(...base, ...(ch === " " ? [] : [[38, ch]])));
  });
  return lines.join("\n") + "\n";
}
const control = [A([17, "R"], [19, "R1"]), A([19, "F1"], [30, "   10"], [35, "A"], [39, "  1"], [42, "  2"])].join("\n") + "\n";

if (process.argv.includes("--dry")) {
  for (const [n, s] of [["位置あり", build(true)], ["位置なし", build(false)], ["対照", control]]) {
    console.log(`\n===== ${n} 行=${s.trimEnd().split("\n").length} =====`);
    console.log(s.trimEnd().split("\n").slice(0, 4).join("\n") + "\n   …");
  }
  process.exit(0);
}

const db = await DbConnection.connect({ ...creds, resolvePort: true });
const printer = await NetPrintConnection.connect({ ...creds, resolvePort: true });
const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
const spools = [];

async function compile(name, source) {
  const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
  try { await ifs.writeFile(`${IFS}/${name}.dds`, new TextEncoder().encode(source), { create: true, truncate: true }); }
  finally { ifs.close(); }
  await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${name}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPU38.FILE/${name}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await cmd.run(`CHGPFM FILE(${LIB}/QTMPU38) MBR(${name}) SRCTYPE(PRTF)`);
  const since = new Date(Date.now() - 5000).toISOString().slice(0, 19).replace("T", " ");
  const r = await cmd.run(`CRTPRTF FILE(${LIB}/${name}) SRCFILE(${LIB}/QTMPU38) SRCMBR(${name}) REPLACE(*YES)`);
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
  if (r?.success) await cmd.run(`DLTF FILE(${LIB}/${name})`).catch(() => {});
  await cmd.run(`RMVM FILE(${LIB}/QTMPU38) MBR(${name})`).catch(() => {});
  const ifs2 = await IfsConnection.connect({ ...creds, resolvePort: true });
  try { await ifs2.deleteFile(`${IFS}/${name}.dds`).catch(() => {}); } finally { ifs2.close(); }
  return { created: r?.success ?? false, messages: (r?.messages ?? []).map(m => `${m.id} ${m.text}`), listing };
}

const out = {};
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPU38) RCDLEN(112)`);

  const c = await compile("U38CTL", control);
  console.log(`対照 U38CTL 作成=${c.created ? "○" : "×"}`);
  if (!c.created) { for (const m of c.messages) console.log(`   ${m.slice(0, 100)}`); throw new Error("対照が落ちた。結果を採らない。"); }

  for (const [key, positioned] of [["U38POS", true], ["U38NOP", false]]) {
    const { created, messages, listing } = await compile(key, build(positioned));
    writeFileSync(join(HERE, `exhaustive-${key}.txt`), listing);
    const bodies = parseListing(listing).filter(r => !/\sR\s+REC/u.test(r.text));
    const verdict = {};
    SPACE.forEach((ch, i) => {
      const row = bodies[i];
      if (!row) { verdict[ch] = { v: "行なし" }; return; }
      const bad = row.marks.some(m => m.column === 38 && INVALID.has(m.id));
      verdict[ch] = { v: bad ? "無効" : "受理", marks: row.marks.map(m => `${m.id}@${m.column}`), text: row.text.trim() };
    });
    const accepted = Object.entries(verdict).filter(([, x]) => x.v === "受理").map(([c2]) => c2);
    const flagged = Object.values(verdict).filter(x => x.v === "無効").length;
    out[key] = { positioned, created, messages, verdict, accepted, rows: bodies.length, flagged };
    console.log(`${key} (${positioned ? "位置あり" : "位置なし"}) 行 ${bodies.length}  受理 ${accepted.length}: ${accepted.map(x => x === " " ? "_" : x).join("")}`);
    console.log(flagged === 0 ? "  ! 印がゼロ → 雛形が 38 桁に届いていない。結果を採らない" : `  印が付いた文字 ${flagged} 件`);
  }
  await cmd.run(`DLTF FILE(${LIB}/QTMPU38)`);
} finally { cmd.close(); db.close(); printer.close(); }

writeFileSync(join(HERE, "prtf38-report.json"), JSON.stringify({ out, spools }, null, 2));
console.log(`\n**残したスプール** ${spools.length} 件`);
for (const s of spools) console.log(`  ${s}`);
