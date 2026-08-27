#!/usr/bin/env node
/**
 * **折り返して書き出したキーワード欄が、実機で同じ値に解決されるか。**
 *
 * 本 PJ の `foldKeywordArea` が折った行を実機でコンパイルし、リストの
 * `Expanded Source`（＝コンパイラが解決した結果）と、折る前のテキストを突き合わせる。
 *
 * 折り方が間違っていると **コンパイルは通るのに値が変わる**（空白が増える・記号が混ざる）。
 * それは画面を見ても気づけないので、実機の解決結果で確かめる。
 *
 * 前提と実行方法は `20260827-dds-keyword-continuation/verify/verify-continuation.mjs` と同じ:
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
const MEMBER = "FOLDTST";

for (const path of [
  join(TS5250, "packages/hostserver/dist/index.js"),
  join(TS5250, "packages/ebcdic/dist/index.js"),
  join(TS5250, "packages/server/dist/secret-crypto.js"),
  join(TS5250, "profiles.local.json"),
  join(REPO, "vscode-extension/out/core/dds/ddsEditWriteBack.js")
]) {
  if (!existsSync(path)) {
    console.error(`前提が足りません: ${path}`);
    process.exit(2);
  }
}

const { CommandConnection, IfsConnection, DbConnection, query } = await import(
  join(TS5250, "packages/hostserver/dist/index.js")
);
const { decodeCcsidText } = await import(join(TS5250, "packages/ebcdic/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const { foldKeywordArea, buildKeywordLine } = await import(
  join(REPO, "vscode-extension/out/core/dds/ddsEditWriteBack.js")
);
const { parseKeywordEntries } = await import(
  join(REPO, "vscode-extension/out/core/dds/ddsKeywords.js")
);
const { printWidth } = await import(join(REPO, "vscode-extension/out/core/dbcs.js"));

const LIB = process.env.AS400_LIB ?? "TESTLIB";
const IFS = process.env.AS400_IFS_DIR ?? "/home/USER";
const SRCF = "QDDSSRC";

const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const wanted = process.env.AS400_SYSTEM ?? "SR-OSAKA";
const sys = profiles.systems.find(s => s.id === wanted || s.name === wanted);
if (!sys) { console.error("システム設定が見つかりません"); process.exit(2); }
const creds = {
  host: sys.host,
  user: sys.signon.user,
  password: process.env.AS400_PASSWORD ?? SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc)
};
if (!creds.password) { console.error("パスワードを解決できません"); process.exit(2); }

// ---- 検証したい定数（どれも 36 桁に収まらない） --------------------------
const CASES = [
  { row: 3, text: "'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'" },          // リテラル 1 つで超える → `-`
  { row: 5, text: "'SHORT' DSPATR(HI) COLOR(RED) DSPATR(UL)" },        // 切れ目で折れる
  { row: 7, text: "'WITH SPACES  INSIDE  KEPT' DSPATR(HI)" },          // 空白を含むリテラル
  { row: 9, text: "'PAREN(X)' COLOR(BLU)" }                            // 括弧を含むリテラル（対照）
];

const put = (line, column, value) => {
  const a = line.split("");
  for (let i = 0; i < value.length; i += 1) a[column - 1 + i] = value[i];
  return a.join("");
};
const A = () => put(" ".repeat(80), 6, "A");

const source = ["     A          R FOLDR", put(A(), 45, "CA03(03)").replace(/ +$/u, "")];
for (const testCase of CASES) {
  const chunks = foldKeywordArea(testCase.text);
  const head = put(put(put(A(), 39, String(testCase.row).padStart(3)), 42, "  2"), 45, chunks[0]);
  source.push(head.replace(/ +$/u, ""));
  for (const chunk of chunks.slice(1)) source.push(buildKeywordLine(chunk));
}
for (const line of source) {
  if (line.length > 80) { console.error(`80 桁を超えた行を作った: |${line}|`); process.exit(1); }
}

console.log("=== 折り返した DDS ===");
for (const line of source) console.log(`|${line}|`);

// ---- 送ってコンパイル ----------------------------------------------------
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
    console.error("**折った結果がコンパイルを通らなかった**:",
      created.messages.map(m => `${m.id} ${m.text}`).join(" / "));
    process.exit(1);
  }
} finally { cmd.close(); }

// ---- リストを読む --------------------------------------------------------
const db = await DbConnection.connect({ ...creds, resolvePort: true });
let spool;
try {
  const r = await query(db, `SELECT FILE_NUMBER, JOB_NAME FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
    WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME = '${MEMBER}'
    ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 1 ROWS ONLY`);
  spool = r.rows[0];
} finally { db.close(); }
if (!spool) { console.error("コンパイル・リストが見つかりません"); process.exit(1); }

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
  listing = decodeCcsidText(file.ccsid ?? 5035, file.data).text.split(/\r?\n/u);
} finally { ifs2.close(); }

/**
 * Expanded Source から「行 → { 解決後の長さ, リストに出た本文 }」を拾う。
 *
 * ■ 本文は**ソースの見た目**、長さは**解決した結果**
 *   リストの本文欄はソース行をそのまま並べ、幅で折り返す（末尾に `+` が付く）。
 *   一方 **Field length 欄は解決後の値**なので、**空白が増えたか / 継続記号が
 *   混ざったかは長さで分かる**。突き合わせはそちらを正にする。
 */
function machineEntries(lines) {
  const out = new Map();
  let inExpanded = false;
  let current;

  for (const line of lines) {
    if (/Expanded Source/u.test(line)) { inExpanded = true; continue; }
    if (/E N D   O F   E X P A N D E D/u.test(line)) break;
    if (!inExpanded) continue;

    const head = /^\s*\d+\s+(\d+)\s+\d+(.*?)\s+(\d+)\s*$/u.exec(line);
    if (head) {
      current = { row: Number(head[1]), body: head[2].trim(), length: Number(head[3]) };
      out.set(current.row, current);
      continue;
    }
    // 折り返しの続き。**行番号は付くが、行/桁と長さ欄を持たない**。
    const tail = /^\s*\d+\s{2,}(\S.*?)\s*$/u.exec(line);
    if (current && tail) {
      current.body = `${current.body.replace(/\s*\+$/u, "")}${tail[1]}`;
    }
  }
  return out;
}

const entries = machineEntries(listing);
const problems = [];

console.log("\n=== 実機の解決結果 ===");
for (const testCase of CASES) {
  const actual = entries.get(testCase.row);
  const parsed = parseKeywordEntries(testCase.text);
  const literal = parsed.find(e => e.kind === "literal");
  // 定数の長さ ＝ リテラルの表示桁数（SO/SI 込み）。折り方を間違えると必ずここがずれる。
  const expected = literal ? printWidth(literal.raw.slice(1, -1).replace(/''/gu, "'")) : 0;

  console.log(
    `  ${String(testCase.row).padStart(2)} 行 長さ=${actual?.length ?? "-"}（期待 ${expected}）` +
    ` 本文 ${JSON.stringify(actual?.body ?? "")}`
  );

  if (actual === undefined) {
    problems.push(`${testCase.row} 行: 実機のリストに出てこない`);
    continue;
  }
  if (actual.length !== expected) {
    problems.push(
      `${testCase.row} 行: 解決後の長さが ${actual.length}（期待 ${expected}）` +
      `——空白が増えたか継続記号が混ざっている`
    );
  }
  // キーワードは本文で確かめる（長さ欄は定数のリテラルの分だけ）。
  for (const entry of parsed) {
    if (entry.kind !== "keyword") continue;
    if (!actual.body.replace(/\s+/gu, "").includes(entry.raw.replace(/\s+/gu, ""))) {
      problems.push(`${testCase.row} 行: ${entry.raw} がリストに現れない（${actual.body}）`);
    }
  }
}

if (problems.length > 0) {
  console.error(`\n✗ 不一致 ${problems.length} 件`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\n✓ 折り返した結果が実機で同じ値に解決された");
