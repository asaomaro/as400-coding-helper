#!/usr/bin/env node
/**
 * **DDS の定位置欄（1 文字）の値集合を、全 37 通りの網羅で確かめる。**
 *
 * `restricted: true` を立てるには「列挙が制限として正しい」だけでなく
 * **「漏れが無い」**ことが要る。列挙された値を試すだけでは漏れは分からない。
 * 1 文字の欄は空間が 37 通り（ブランク ＋ A-Z ＋ 0-9）なので、全部試せば決まる。
 *
 * ## 判定（spec D1）
 *
 * 作成の成否では決まらない。**有効な値でも長さ・小数の前提が違えば落ちる**ので、
 * リストの `メッセージ番号 + 印が指す桁` の組で読む。
 *
 * | 番号 | 意味 | 集合 |
 * |---|---|---|
 * | `CPD7419` Data type not valid.                  | 値が無効 | 無効 |
 * | `CPD7410` （示された欄に使えない文字）           | 値が無効 | 無効 |
 * | `CPD7408` Entry for decimal positions or field length not valid. | 値は受理 | **受理** |
 * | `CPD7635` Length too large for floating-point precision.        | 値は受理 | **受理** |
 *
 * ## 17 桁は 2 段（spec D5）
 *
 * 17 桁は値ごとに行の役割が変わる（`R` は新しいレコードを始め、`K` はキー）。
 * 一括では構造の崩れが他の行の指摘を消しうるので「指摘が無い＝有効」と言えない。
 * **一括で無効を確定し、印が付かなかった値だけ単独で確かめる。**
 * （付いた印は事実なので、無効の判定は他の行に影響されない）
 *
 * ## スプールは消さない（spec D9）
 *
 * このスクリプトは `DLTSPLF` を持たない。作ったスプールは名前を報告して残す。
 * 作成したファイル・メンバー・ソース物理ファイル・IFS は名前が一意なので消す。
 *
 * ## `CRTPF` に `REPLACE` は無い（research F1）
 *
 * `CPD0043` で落ち、**DDS が一度も評価されない**。`DLTF` で場所を空けてから作る。
 *
 * 使い方: cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify <このファイル>
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
const pad3 = n => `  ${n}`.slice(-3);

/** 1 文字の欄の全空間。 */
const SPACE = [" ", ...("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""))];
/** 値が無効であることを意味する番号。他（CPD7408 / CPD7635）は「受理」側。 */
const INVALID = new Set(["CPD7410", "CPD7419"]);

const CRT = {
  PF: n => [`DLTF FILE(${LIB}/${n})`, `CRTPF FILE(${LIB}/${n}) SRCFILE(${LIB}/QTMPEXH) SRCMBR(${n})`],
  DSPF: n => [`CRTDSPF FILE(${LIB}/${n}) SRCFILE(${LIB}/QTMPEXH) SRCMBR(${n}) REPLACE(*YES)`],
  PRTF: n => [`CRTPRTF FILE(${LIB}/${n}) SRCFILE(${LIB}/QTMPEXH) SRCMBR(${n}) REPLACE(*YES)`]
};
/** 位置欄が要るのは画面と帳票だけ。 */
const POSITIONED = { PF: false, DSPF: true, PRTF: true };

/** 項目を 1 つ書く。`column` の値だけを差し替え、他は通ると分かっている形に固定する。 */
function field(type, name, column, ch, row) {
  const base = [[19, name], [30, "   10"], [35, "A"]];
  if (POSITIONED[type]) base.push([39, pad3(row)], [42, "  2"]);
  return A(...base.filter(([c]) => c !== column), ...(ch === " " ? [] : [[column, ch]]));
}

/** 35 / 38 桁: 1 レコードに項目を並べる（画面は 24 行なので 19 項目で区切る）。 */
function buildValueSource(type, column) {
  const lines = [], map = [];
  const per = POSITIONED[type] ? 19 : 37;
  SPACE.forEach((ch, i) => {
    if (i % per === 0) lines.push(A([17, "R"], [19, `REC${Math.floor(i / per)}`]));
    lines.push(field(type, `F${String(i).padStart(2, "0")}`, column, ch, (i % per) + 1));
    map.push(ch);
  });
  return { source: lines.join("\n") + "\n", map };
}

/**
 * 17 桁: **先に有効な項目を 1 つ置いて**から、17 桁だけを変えた行を並べる。
 * `K`(キー) や `S`/`O`(選択・省略) は既存の項目名を参照する形なので、
 * 参照先が無いと「値が無効」ではなく別の理由で落ちる。
 */
function buildTypeSource(type) {
  const lines = [A([17, "R"], [19, "R1"]), field(type, "F1", -1, " ", 1)];
  const map = [];
  SPACE.forEach(ch => {
    lines.push(A(...(ch === " " ? [] : [[17, ch]]), [19, "F1"]));
    map.push(ch);
  });
  return { source: lines.join("\n") + "\n", map };
}

/** 種別ごとの「通ると分かっている最小形」。雛形が健全であることの対照。 */
function buildControl(type) {
  return [A([17, "R"], [19, "R1"]), field(type, "F1", -1, " ", 1)].join("\n") + "\n";
}

const TARGETS = [
  { key: "XPF35", type: "PF", column: 35, kind: "value" },
  { key: "XPF38", type: "PF", column: 38, kind: "value" },
  { key: "XPF17", type: "PF", column: 17, kind: "type" },
  { key: "XDS35", type: "DSPF", column: 35, kind: "value" },
  { key: "XDS17", type: "DSPF", column: 17, kind: "type" },
  { key: "XPR35", type: "PRTF", column: 35, kind: "value" },
  { key: "XPR17", type: "PRTF", column: 17, kind: "type" },
  { key: "CPF00", type: "PF", column: 0, kind: "control" },
  { key: "CDS00", type: "DSPF", column: 0, kind: "control" },
  { key: "CPR00", type: "PRTF", column: 0, kind: "control" }
];

const build = t =>
  t.kind === "control" ? { source: buildControl(t.type), map: [] }
    : t.kind === "type" ? buildTypeSource(t.type)
      : buildValueSource(t.type, t.column);

/**
 * **`--dry` で実機に触らずソースだけを出す。** 雛形の誤りで共用機を叩かないため。
 * 前回は `CRTPF` の `REPLACE` で 4 回無駄に流している。
 */
if (process.argv.includes("--dry")) {
  for (const t of TARGETS) {
    const { source, map } = build(t);
    console.log(`\n===== ${t.key} (${t.type} ${t.column || "-"}桁 ${t.kind}) 行=${source.trimEnd().split("\n").length} 値=${map.length} =====`);
    console.log(source.trimEnd().split("\n").slice(0, 5).join("\n"));
    if (source.trimEnd().split("\n").length > 5) console.log("   …");
    const over = source.split("\n").filter(l => l.length > 80);
    if (over.length) console.log(`  ! 80 桁超えが ${over.length} 行`);
  }
  process.exit(0);
}

const db = await DbConnection.connect({ ...creds, resolvePort: true });
const printer = await NetPrintConnection.connect({ ...creds, resolvePort: true });
const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
const spools = [];

/** 送る → 型付け → 作る → リストを読む。**消すのは自分が作ったものだけ。** */
async function compile(name, type, source) {
  const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
  try { await ifs.writeFile(`${IFS}/${name}.dds`, new TextEncoder().encode(source), { create: true, truncate: true }); }
  finally { ifs.close(); }
  await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${name}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPEXH.FILE/${name}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await cmd.run(`CHGPFM FILE(${LIB}/QTMPEXH) MBR(${name}) SRCTYPE(${type})`);
  const since = new Date(Date.now() - 5000).toISOString().slice(0, 19).replace("T", " ");
  let r = null;
  for (const cl of CRT[type](name)) r = await cmd.run(cl);

  const q = await query(db, `SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
    WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME = '${name}'
      AND CREATE_TIMESTAMP >= TIMESTAMP('${since}')
    ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 1 ROWS ONLY`);
  const sp = q.rows?.[0];
  let listing = "";
  if (sp) {
    const [jobNumber, jobUser, jobName] = String(sp.JOB_NAME).split("/");
    const pages = await printer.readSpooledPages({ fileName: name, fileNumber: sp.FILE_NUMBER, jobName, jobUser, jobNumber });
    listing = pages.flatMap(p => (p.lines ?? p.rows ?? []).map(l => (typeof l === "string" ? l : l.text ?? ""))).join("\n");
    spools.push(`${name} #${sp.FILE_NUMBER} ${sp.JOB_NAME}`);
  }
  if (r?.success) await cmd.run(`DLTF FILE(${LIB}/${name})`).catch(() => {});
  await cmd.run(`RMVM FILE(${LIB}/QTMPEXH) MBR(${name})`).catch(() => {});
  const ifs2 = await IfsConnection.connect({ ...creds, resolvePort: true });
  try { await ifs2.deleteFile(`${IFS}/${name}.dds`).catch(() => {}); } finally { ifs2.close(); }
  return { created: r?.success ?? false, messages: (r?.messages ?? []).map(m => `${m.id} ${m.text}`), listing };
}

const results = {};
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPEXH) RCDLEN(112)`);

  for (const t of TARGETS) {
    const { source, map } = build(t);
    const { created, messages, listing } = await compile(t.key, t.type, source);
    writeFileSync(join(HERE, `exhaustive-${t.key}.txt`), listing);

    if (t.kind === "control") {
      // **対照。作成できなければ雛形が壊れている。以降の結果を採ってはいけない。**
      results[t.key] = { kind: "control", type: t.type, created, messages };
      console.log(`${t.key} 対照(${t.type}) 作成=${created ? "○" : "×"}${created ? "" : "  ← **雛形が壊れている**"}`);
      for (const m of messages) console.log(`        ${m.slice(0, 100)}`);
      continue;
    }

    // 解析はソース行の並びで突き合わせる。1 行目はレコード行なので飛ばす。
    const rows = parseListing(listing);
    const bodies = rows.filter(r => !/\sR\s+REC|\sR\s+R1/u.test(r.text));
    const verdict = {};
    map.forEach((ch, i) => {
      const row = t.kind === "type" ? bodies[i + 1] : bodies[i];   // type は先頭に有効項目を 1 つ置いている
      if (!row) { verdict[ch] = { v: "行なし", marks: [] }; return; }
      const marks = row.marks.map(m => `${m.id}@${m.column}`);
      const bad = row.marks.some(m => m.column === t.column && INVALID.has(m.id));
      verdict[ch] = { v: bad ? "無効" : "受理", marks, seq: row.seq, text: row.text.trim() };
    });
    const accepted = Object.entries(verdict).filter(([, x]) => x.v === "受理").map(([c]) => c);
    const invalid = Object.entries(verdict).filter(([, x]) => x.v === "無効").map(([c]) => c);
    results[t.key] = { ...t, created, messages, verdict, accepted, invalid, rows: bodies.length };
    console.log(`${t.key} ${t.type} ${t.column}桁  行 ${bodies.length}/${map.length}  受理 ${accepted.length}: ${accepted.map(c => c === " " ? "_" : c).join("")}`);
  }

  // --- 17 桁の単独確認（段 2） ---
  for (const t of TARGETS.filter(x => x.kind === "type")) {
    const confirm = {};
    for (const ch of results[t.key].accepted) {
      const name = `${t.key}${ch === " " ? "B" : ch}`.slice(0, 10);
      const lines = [A([17, "R"], [19, "R1"]), field(t.type, "F1", -1, " ", 1),
        A(...(ch === " " ? [] : [[17, ch]]), [19, "F1"])];
      const { created, listing } = await compile(name, t.type, lines.join("\n") + "\n");
      writeFileSync(join(HERE, `confirm-${name}.txt`), listing);
      const bad = parseListing(listing).some(r => r.marks.some(m => m.column === 17 && INVALID.has(m.id)));
      confirm[ch] = { created, verdict: bad ? "無効" : "受理" };
      console.log(`  単独 ${t.key} 17桁='${ch === " " ? "_" : ch}' 作成=${created ? "○" : "×"} → ${bad ? "無効" : "受理"}`);
    }
    results[t.key].confirm = confirm;
    results[t.key].acceptedConfirmed = Object.entries(confirm).filter(([, x]) => x.verdict === "受理").map(([c]) => c);
  }

  await cmd.run(`DLTF FILE(${LIB}/QTMPEXH)`);
} finally {
  cmd.close(); db.close(); printer.close();
}

writeFileSync(join(HERE, "exhaustive-report.json"), JSON.stringify({ results, spools }, null, 2));
console.log(`\n**残したスプール（消していない。片付けは人が決める）** ${spools.length} 件`);
for (const s of spools) console.log(`  ${s}`);
