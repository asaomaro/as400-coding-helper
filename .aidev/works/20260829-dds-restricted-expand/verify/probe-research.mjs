#!/usr/bin/env node
/**
 * **research 用のプローブ。** spec を書く前に不確実性を実機で潰す。
 *
 * Q1: 物理/論理（PF）の雛形はなぜ落ちたのか。
 * Q2: 17 桁（仕様のタイプ）の無効値を、構造由来の失敗と読み分けられるか。
 *
 * ## スプールは消さない（2026-08-29 の決定）
 *
 * **このスクリプトは `DLTSPLF` を持たない。** 初版は片付けのつもりで
 * 「利用者の直近 3 件」を順位で掴んで消しており、`CRTPF` が `CPD0043` で
 * 即座に落ちてリストが 1 件も出なかった回に、**無関係な既存スプールを
 * 約 15 件消した**（復元不可）。
 *
 * 順位で消したことが誤りだが、名前で照合する形に直しても
 * 「消す」判断がスクリプトに残る。**残して名前を報告し、片付けは人が決める。**
 * 作成したオブジェクト・メンバー・IFS は名前が一意なので消してよい。
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

/**
 * **`CRTPF` に `REPLACE` は無い**（`CPD0043`）。`CRTDSPF` / `CRTPRTF` にはある。
 * 前作業はこれを流用して落ち、「雛形が誤り」と誤診していた。
 * PF は作る前に `DLTF` して場所を空ける。
 */
const CRT = {
  PF:   n => [`DLTF FILE(${LIB}/${n})`, `CRTPF FILE(${LIB}/${n}) SRCFILE(${LIB}/QTMPRSH) SRCMBR(${n})`],
  DSPF: n => [`CRTDSPF FILE(${LIB}/${n}) SRCFILE(${LIB}/QTMPRSH) SRCMBR(${n}) REPLACE(*YES)`],
  PRTF: n => [`CRTPRTF FILE(${LIB}/${n}) SRCFILE(${LIB}/QTMPRSH) SRCMBR(${n}) REPLACE(*YES)`]
};

/** **対照を必ず混ぜる。** 対照が期待どおりでない回の結果は採らない。 */
const CASES = [
  // Q1: PF の最小形（位置欄なし・キーなし）
  { n: "RPFA", type: "PF", expect: true, why: "対照 PF 35=A（通るはず）",
    src: [A([17, "R"], [19, "R1"]), A([19, "F1"], [30, "   10"], [35, "A"])] },
  { n: "RPFQ", type: "PF", expect: false, why: "対照 PF 35=Q（原典に無い。落ちるはず）",
    src: [A([17, "R"], [19, "R1"]), A([19, "F1"], [30, "   10"], [35, "Q"])] },
  // Q2: 17 桁
  { n: "RPFK", type: "PF", expect: true, why: "対照 PF 17=K（キー。PF では有効なはず）",
    src: [A([17, "R"], [19, "R1"]), A([19, "F1"], [30, "   10"], [35, "A"]), A([17, "K"], [19, "F1"])] },
  { n: "RPFX", type: "PF", expect: false, why: "**PF 17=X**（どの種別にも無い）",
    src: [A([17, "R"], [19, "R1"]), A([19, "F1"], [30, "   10"], [35, "A"]), A([17, "X"], [19, "F1"])] },
  { n: "RDSK", type: "DSPF", expect: false, why: "**DSPF 17=K**（PF にはあるが DSPF に無い）",
    src: [A([17, "R"], [19, "R1"]), A([17, "K"], [19, "F1"], [30, "   10"], [35, "A"], [39, "  1"], [42, "  2"])] },
  { n: "RPRK", type: "PRTF", expect: false, why: "**PRTF 17=K**（PRTF に無い）",
    src: [A([17, "R"], [19, "R1"]), A([17, "K"], [19, "F1"], [30, "   10"], [35, "A"], [39, "  1"], [42, "  2"])] }
];

/** リストの `*` 印が指す桁を求める。`A` は必ず 6 桁目にあるので、そこを基準にする。 */
function markedColumns(listing) {
  const lines = listing.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^\*\s+(CP[DF]\d{4})-(\*+)/u);
    if (!m) continue;
    const src = lines[i - 1] ?? "";
    const base = src.indexOf(" A ") >= 0 ? src.indexOf(" A ") + 1 : -1;   // 6 桁目の A
    const col = base >= 0 ? lines[i].indexOf("-" + m[2]) + 1 - base + 6 : null;
    hits.push({ id: m[1], column: col, source: src.trimEnd() });
  }
  return hits;
}

const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try {
  for (const c of CASES) await ifs.writeFile(`${IFS}/${c.n}.dds`, new TextEncoder().encode(c.src.join("\n") + "\n"), { create: true, truncate: true });
} finally { ifs.close(); }

const db = await DbConnection.connect({ ...creds, resolvePort: true });
const printer = await NetPrintConnection.connect({ ...creds, resolvePort: true });
const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
const report = [];
const spools = [];
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPRSH) RCDLEN(112)`);
  for (const c of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.n}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPRSH.FILE/${c.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QTMPRSH) MBR(${c.n}) SRCTYPE(${c.type})`);
    const t0 = new Date(Date.now() - 5000).toISOString().slice(0, 19).replace("T", " ");
    let r = null;
    for (const cl of CRT[c.type](c.n)) r = await cmd.run(cl);   // PF は DLTF → CRTPF

    // **自分が作ったリストだけを、名前と時刻の両方で特定する。** 消さない。
    const q = await query(db, `SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
      WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME = '${c.n}'
        AND CREATE_TIMESTAMP >= TIMESTAMP('${t0}')
      ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 1 ROWS ONLY`);
    const sp = q.rows?.[0];
    let listing = "";
    if (sp) {
      const [jobNumber, jobUser, jobName] = String(sp.JOB_NAME).split("/");
      try {
        const pages = await printer.readSpooledPages({ fileName: c.n, fileNumber: sp.FILE_NUMBER, jobName, jobUser, jobNumber });
        listing = pages.flatMap(p => (p.lines ?? p.rows ?? []).map(l => (typeof l === "string" ? l : l.text ?? ""))).join("\n");
      } catch (e) { listing = `(読めず: ${e.message})`; }
      spools.push(`${c.n} #${sp.FILE_NUMBER} ${sp.JOB_NAME}`);
    }
    // **リストは 2 部構成**（ソース → 展開後ソース）。前半だけを見る。
    const head = listing.split("E N D   O F   S O U R C E")[0] ?? listing;
    const marks = markedColumns(head);
    report.push({ n: c.n, type: c.type, why: c.why, expect: c.expect, created: r?.success ?? false,
      msgs: (r?.messages ?? []).map(m => `${m.id} ${m.text}`.slice(0, 120)), marks });
    writeFileSync(join(HERE, `research-${c.n}.txt`), listing);
    console.log(`${c.n} (${c.type}) 作成=${r?.success ? "○" : "×"}(期待 ${c.expect ? "○" : "×"}) ${marks.map(m => `${m.id}@${m.column}桁`).join(" ") || "(印なし)"}`);
    for (const m of (r?.messages ?? [])) console.log(`       ${m.id} ${m.text.slice(0, 95)}`);
    if (r?.success) await cmd.run(`DLTF FILE(${LIB}/${c.n})`).catch(() => {});
    await cmd.run(`RMVM FILE(${LIB}/QTMPRSH) MBR(${c.n})`).catch(() => {});
  }
  await cmd.run(`DLTF FILE(${LIB}/QTMPRSH)`);
} finally {
  cmd.close(); db.close(); printer.close();
  const clean = await IfsConnection.connect({ ...creds, resolvePort: true });
  try { for (const c of CASES) await clean.deleteFile(`${IFS}/${c.n}.dds`).catch(() => {}); } finally { clean.close(); }
}
console.log(`\n**残したスプール（片付けは人が決める）**\n${spools.map(s => "  " + s).join("\n")}`);
writeFileSync(join(HERE, "research-report.json"), JSON.stringify({ report, spools }, null, 2));
