#!/usr/bin/env node
/**
 * **帳票の行送りの解決を、実機の印刷結果と突き合わせる。**
 *
 * `resolvePrtfLayout` は `SPACEA` / `SPACEB` / `SKIPA` / `SKIPB` を解いて絶対の行を出すが、
 * これまで**原典から起こしたまま実機で確かめていなかった**。行がずれても
 * 画面では分からず、印刷して初めて気づく類。
 *
 * やること:
 *   1. `PRTTST.prtf` と、それに書く RPG（`PRTTSTR`）を実機へ送ってコンパイル
 *   2. 呼び出してスプールを作る
 *   3. スプールを**テキストとして読み**、行・桁を拾う
 *   4. `buildPrtfRenderModel` の結果と突き合わせる
 *
 * 実行:
 *   cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify <このファイル>
 *
 * 終了コード: 0=一致 / 1=不一致 / 2=前提が足りない
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS5250 = process.env.TS5250_ROOT ?? "/workspaces/ts5250";
const REPO = join(HERE, "..", "..", "..", "..");
const DDS = "PRTTST";
const RPG = "PRTTSTR";

for (const path of [
  join(TS5250, "packages/hostserver/dist/index.js"),
  join(TS5250, "profiles.local.json"),
  join(REPO, "vscode-extension/out/core/dds/prtfRenderModel.js")
]) {
  if (!existsSync(path)) { console.error(`前提が足りません: ${path}`); process.exit(2); }
}

const { CommandConnection, IfsConnection, DbConnection, query, NetPrintConnection } = await import(
  join(TS5250, "packages/hostserver/dist/index.js")
);
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const { buildPrtfRenderModel } = await import(join(REPO, "vscode-extension/out/core/dds/prtfRenderModel.js"));

const LIB = process.env.AS400_LIB ?? "TESTLIB";
const IFS = process.env.AS400_IFS_DIR ?? "/home/USER";
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const wanted = process.env.AS400_SYSTEM ?? "SR-OSAKA";
const sys = profiles.systems.find(s => s.id === wanted || s.name === wanted);
if (!sys) { console.error("システム設定が見つかりません"); process.exit(2); }
const creds = {
  host: sys.host, user: sys.signon.user,
  password: process.env.AS400_PASSWORD ?? SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc)
};
if (!creds.password) { console.error("パスワードを解決できません"); process.exit(2); }

const ddsLines = readFileSync(join(HERE, `${DDS}.prtf`), "utf8").split(/\r?\n/u);
const rpgLines = readFileSync(join(HERE, `${RPG}.rpgle`), "utf8").split(/\r?\n/u);

// ---- 1. 送ってコンパイル -------------------------------------------------
const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try {
  const write = (name, lines) =>
    ifs.writeFile(`${IFS}/${name}`, new TextEncoder().encode(lines.join("\n") + "\n"), {
      create: true, truncate: true
    });
  await write(`${DDS}.prtf`, ddsLines);
  await write(`${RPG}.rpgle`, rpgLines);
} finally { ifs.close(); }

const fail = (label, result) => {
  console.error(`${label}: ${result.messages.map(m => `${m.id} ${m.text}`).join(" / ")}`);
  process.exit(1);
};

const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QDDSSRC) RCDLEN(112) TEXT('DDS source')`);
  await cmd.run(`CRTSRCPF FILE(${LIB}/QRPGLESRC) RCDLEN(112) TEXT('RPGLE source')`);
  await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${DDS}.prtf') TOMBR('/QSYS.LIB/${LIB}.LIB/QDDSSRC.FILE/${DDS}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await cmd.run(`CHGPFM FILE(${LIB}/QDDSSRC) MBR(${DDS}) SRCTYPE(PRTF)`);
  const prtf = await cmd.run(`CRTPRTF FILE(${LIB}/${DDS}) SRCFILE(${LIB}/QDDSSRC) SRCMBR(${DDS}) REPLACE(*YES)`);
  if (!prtf.success) fail("CRTPRTF", prtf);

  // **コンパイルより先にライブラリー・リストへ入れる。** 外部記述の印刷装置ファイルは
  // コンパイル時に解決されるので、後から足しても `RNF2120` になる（実際に踏んだ）。
  await cmd.run(`ADDLIBLE LIB(${LIB})`);

  await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${RPG}.rpgle') TOMBR('/QSYS.LIB/${LIB}.LIB/QRPGLESRC.FILE/${RPG}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await cmd.run(`CHGPFM FILE(${LIB}/QRPGLESRC) MBR(${RPG}) SRCTYPE(RPGLE)`);
  const pgm = await cmd.run(`CRTBNDRPG PGM(${LIB}/${RPG}) SRCFILE(${LIB}/QRPGLESRC) SRCMBR(${RPG}) REPLACE(*YES)`);
  if (!pgm.success) fail("CRTBNDRPG", pgm);

  // 2. 呼び出してスプールを作る
  const call = await cmd.run(`CALL PGM(${LIB}/${RPG})`);
  if (!call.success) fail("CALL", call);
} finally { cmd.close(); }

// ---- 3. スプールをテキストで読む ----------------------------------------
const db = await DbConnection.connect({ ...creds, resolvePort: true });
let spool;
try {
  const r = await query(db, `SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
    WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME = '${DDS}'
    ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 1 ROWS ONLY`);
  spool = r.rows[0];
} finally { db.close(); }
if (!spool) { console.error("スプールが見つかりません"); process.exit(1); }

const [jobNumber, jobUser, jobName] = String(spool.JOB_NAME).split("/");
const printer = await NetPrintConnection.connect({ ...creds, resolvePort: true });
let pages;
try {
  pages = await printer.readSpooledPages({
    fileName: spool.SPOOLED_FILE_NAME,
    fileNumber: spool.FILE_NUMBER,
    jobName, jobUser, jobNumber
  });
} finally { printer.close(); }

/** 論理ページの行から「行 → その行にある文字の並び」を作る。 */
function printed(page) {
  const found = [];
  (page.lines ?? page.rows ?? []).forEach((line, index) => {
    const text = typeof line === "string" ? line : (line.text ?? "");
    let start = -1;
    for (let i = 0; i <= text.length; i += 1) {
      const filled = i < text.length && text[i] !== " ";
      if (filled && start < 0) start = i;
      if (!filled && start >= 0) {
        found.push({ row: index + 1, column: start + 1, text: text.slice(start, i) });
        start = -1;
      }
    }
  });
  return found;
}

const machine = printed(pages[0] ?? {});

// ---- 4. 突き合わせ -------------------------------------------------------
// 本 PJ は「レコード様式を 1 回ずつ書いた」ときの位置を出す。RPG は P2 を 2 回書くので、
// **最初の 1 回ぶん**（P1 / P2 / P3 の 1 回目）だけを比べる。
const model = buildPrtfRenderModel(ddsLines);
const expected = model.items.map(item => ({
  row: item.row,
  column: item.column,
  text: item.label
}));

console.log("=== 実機の印刷結果（1 ページ目） ===");
for (const entry of machine) console.log(`  ${String(entry.row).padStart(2)} 行 ${String(entry.column).padStart(3)} 桁 ${JSON.stringify(entry.text)}`);
console.log("=== 本 PJ の解決結果 ===");
for (const entry of expected) console.log(`  ${String(entry.row).padStart(2)} 行 ${String(entry.column).padStart(3)} 桁 ${JSON.stringify(entry.text)}`);

const problems = [];
for (const want of expected) {
  const hit = machine.find(entry => entry.text === want.text);
  if (!hit) { problems.push(`${JSON.stringify(want.text)} が印刷結果に無い`); continue; }
  if (hit.row !== want.row || hit.column !== want.column) {
    problems.push(
      `${JSON.stringify(want.text)}: 実機 ${hit.row} 行 ${hit.column} 桁 / 本 PJ ${want.row} 行 ${want.column} 桁`
    );
  }
}

if (problems.length > 0) {
  console.error(`\n✗ 不一致 ${problems.length} 件`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\n✓ 行送りの解決が実機の印刷結果と一致");
