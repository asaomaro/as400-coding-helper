#!/usr/bin/env node
/**
 * **キーワード欄の継続を実機と突き合わせる。**
 *
 * ローカルの原典スナップショットに継続規則のページが無いので、実機のコンパイラを正とする
 * （AGENTS.md「原典と実機が食い違ったら、実機のパーサーに判定させる」）。
 *
 * やること:
 *   1. `CONTTST.dspf` を実機のソースメンバーへ送る
 *   2. `CRTDSPF` でコンパイルし、リスト（スプール）を IFS 経由で取り出す
 *   3. リストの **Expanded Source** から「解決後の定数」を読む（実機の答え）
 *   4. 同じソースを `buildDspfRenderModel` に読ませる（本 PJ の答え）
 *   5. 突き合わせる
 *
 * 前提（本 PJ の外にある道具を使う）:
 *   - `/workspaces/ts5250` がある（`@ts5250/hostserver` / `@ts5250/ebcdic` をビルド済み）
 *   - 実機の設定と資格情報は ts5250 側の `.env` / `.env.verify` / `profiles.local.json`
 *
 * 実行:
 *   cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify \
 *     /workspaces/as400-coding-helper/.aidev/works/20260827-dds-keyword-continuation/verify/verify-continuation.mjs
 *
 * 終了コード: 0=一致 / 1=不一致 / 2=前提が足りない
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS5250 = process.env.TS5250_ROOT ?? "/workspaces/ts5250";
const REPO = join(HERE, "..", "..", "..", "..");
const MEMBER = "CONTTST";

for (const path of [
  join(TS5250, "packages/hostserver/dist/index.js"),
  join(TS5250, "packages/ebcdic/dist/index.js"),
  join(TS5250, "packages/server/dist/secret-crypto.js"),
  join(TS5250, "profiles.local.json"),
  join(REPO, "vscode-extension/out/core/dds/dspfRenderModel.js")
]) {
  if (!existsSync(path)) {
    console.error(`前提が足りません: ${path}`);
    console.error("（ts5250 をビルド / 本 PJ を npm run compile してください）");
    process.exit(2);
  }
}

const { CommandConnection, IfsConnection, DbConnection, query } = await import(
  join(TS5250, "packages/hostserver/dist/index.js")
);
const { decodeCcsidText } = await import(join(TS5250, "packages/ebcdic/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const { buildDspfRenderModel } = await import(
  join(REPO, "vscode-extension/out/core/dds/dspfRenderModel.js")
);

const LIB = process.env.AS400_LIB ?? "TESTLIB";
const IFS = process.env.AS400_IFS_DIR ?? "/home/USER";
const SRCF = "QDDSSRC";

const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(
  s => s.id === (process.env.AS400_SYSTEM ?? "SR-OSAKA") || s.name === (process.env.AS400_SYSTEM ?? "SR-OSAKA")
);
if (!sys) { console.error("システム設定が見つかりません"); process.exit(2); }
const creds = {
  host: sys.host,
  user: sys.signon.user,
  password: process.env.AS400_PASSWORD ?? SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc)
};
if (!creds.password) { console.error("パスワードを解決できません"); process.exit(2); }

const source = readFileSync(join(HERE, `${MEMBER}.dspf`), "utf8").split(/\r?\n/u);

// ---- 1-2. 送って、コンパイルする ----------------------------------------
const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try {
  await ifs.writeFile(`${IFS}/${MEMBER}.dds`, new TextEncoder().encode(source.join("\n") + "\n"), {
    create: true, truncate: true
  });
} finally { ifs.close(); }

const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/${SRCF}) RCDLEN(112) TEXT('DDS source')`);
  await cmd.run(
    `CPYFRMSTMF FROMSTMF('${IFS}/${MEMBER}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/${SRCF}.FILE/${MEMBER}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`
  );
  await cmd.run(`CHGPFM FILE(${LIB}/${SRCF}) MBR(${MEMBER}) SRCTYPE(DSPF)`);
  const created = await cmd.run(
    `CRTDSPF FILE(QTEMP/${MEMBER}) SRCFILE(${LIB}/${SRCF}) SRCMBR(${MEMBER}) REPLACE(*YES)`
  );
  if (!created.success) {
    console.error("コンパイルが通りませんでした:", created.messages.map(m => `${m.id} ${m.text}`).join(" / "));
    process.exit(1);
  }
} finally { cmd.close(); }

// ---- 3. リストの Expanded Source を読む ---------------------------------
const db = await DbConnection.connect({ ...creds, resolvePort: true });
let spool;
try {
  const r = await query(db, `SELECT FILE_NUMBER, JOB_NAME FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
    WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME = '${MEMBER}'
    ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 1 ROWS ONLY`);
  spool = r.rows[0];
} finally { db.close(); }
if (!spool) { console.error("コンパイル・リストのスプールが見つかりません"); process.exit(1); }

const cmd2 = await CommandConnection.connect({ ...creds, resolvePort: true });
try {
  await cmd2.run(
    `CPYSPLF FILE(${MEMBER}) TOFILE(*TOSTMF) JOB(${spool.JOB_NAME}) SPLNBR(${spool.FILE_NUMBER}) ` +
    `TOSTMF('${IFS}/${MEMBER}.lst') STMFOPT(*REPLACE) WSCST(*NONE)`
  );
} finally { cmd2.close(); }

const ifs2 = await IfsConnection.connect({ ...creds, resolvePort: true });
let listing;
try {
  const file = await ifs2.readTextFile(`${IFS}/${MEMBER}.lst`);
  // **タグではなく中身の CCSID で復号する。** ジョブの CCSID（EBCDIC）で書かれ、
  // 行末も EBCDIC の NL(0x15) なので、UTF-8 として読むと 1 行に見える。
  listing = decodeCcsidText(file.ccsid ?? 5035, file.data).text.split(/\r?\n/u);
} finally { ifs2.close(); }

/** Expanded Source の定数行から「行,桁,文字列」を拾う。 */
function machineConstants(lines) {
  const out = [];
  let inExpanded = false;
  for (const line of lines) {
    if (/Expanded Source/u.test(line)) { inExpanded = true; continue; }
    if (/E N D   O F   E X P A N D E D/u.test(line)) break;
    if (!inExpanded) continue;
    // 例: `   1100                                         11 12'XYZ' COLOR(RED)   3`
    // **リテラルの後ろにキーワードが続くことがある**ので、末尾の長さまで貪欲に読まない。
    const m = /^\s*\d+\s+(\d+)\s+(\d+)'((?:[^']|'')*)'(?:\s.*?)?\s+(\d+)\s*$/u.exec(line);
    if (m) out.push({ row: Number(m[1]), column: Number(m[2]), text: m[3].replace(/''/gu, "'") });
  }
  return out;
}

// ---- 4-5. 本 PJ の読み取りと突き合わせる --------------------------------
const machine = machineConstants(listing);
const model = buildDspfRenderModel(source);
const ours = model.items
  .filter(item => item.kind === "constant")
  .map(item => ({ row: item.row, column: item.column, text: item.label }));

const key = c => `${c.row},${c.column}`;
const byKey = new Map(ours.map(c => [key(c), c]));
const problems = [];

if (machine.length === 0) problems.push("実機の Expanded Source から定数を読めませんでした");
for (const expected of machine) {
  const actual = byKey.get(key(expected));
  if (!actual) { problems.push(`${key(expected)}: 本 PJ が項目として読めていない（実機: ${JSON.stringify(expected.text)}）`); continue; }
  if (actual.text !== expected.text) {
    problems.push(`${key(expected)}: 実機 ${JSON.stringify(expected.text)} / 本 PJ ${JSON.stringify(actual.text)}`);
  }
  byKey.delete(key(expected));
}
for (const [k, extra] of byKey) problems.push(`${k}: 実機に無い定数を読んでいる（${JSON.stringify(extra.text)}）`);

console.log(`実機の定数 ${machine.length} 件 / 本 PJ の定数 ${ours.length} 件`);
for (const c of machine) console.log(`  ${String(c.row).padStart(2)},${String(c.column).padStart(2)} ${JSON.stringify(c.text)}`);

if (problems.length > 0) {
  console.error(`\n✗ 不一致 ${problems.length} 件`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\n✓ 実機の解決結果と一致");
