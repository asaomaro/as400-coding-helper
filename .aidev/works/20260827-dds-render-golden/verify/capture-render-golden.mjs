#!/usr/bin/env node
/**
 * **`RENDER1.dspf` を実機に出して、画面をそのままゴールデンに採る。**
 *
 * 採るのは**画面の生の事実だけ**——24 × 80 の文字・セルごとの見え方・実機が返す入力欄。
 * モデルの語彙（`segments` / `occupancy` / `widthCols`）は 1 つも入れない。
 * 入れると「モデルを間違えたまま固定する」ことになり、突き合わせの意味が消える。
 *
 * 照合は `test/unit/ddsRenderGolden.test.ts`（実機に繋がない）。このスクリプトは
 * **採り直したいときだけ**回す。
 *
 * 実行:
 *   cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify \
 *     /workspaces/as400-coding-helper/.aidev/works/20260827-dds-render-golden/verify/capture-render-golden.mjs
 *
 * 終了コード: 0=採取した / 1=失敗 / 2=前提が足りない
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS5250 = process.env.TS5250_ROOT ?? "/workspaces/ts5250";
const REPO = join(HERE, "..", "..", "..", "..");
const MEMBER = "RENDER1";
const PROGRAM = "RENDER1C";
const SOURCE = join(REPO, "vscode-extension/test/golden/RENDER1.dspf");
const GOLDEN = join(REPO, "vscode-extension/test/golden/RENDER1.screen.json");

for (const path of [
  join(TS5250, "packages/hostserver/dist/index.js"),
  join(TS5250, "packages/tn5250/dist/index.js"),
  join(TS5250, "profiles.local.json"),
  SOURCE
]) {
  if (!existsSync(path)) { console.error(`前提が足りません: ${path}`); process.exit(2); }
}

const { CommandConnection, IfsConnection } = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { Session5250 } = await import(join(TS5250, "packages/tn5250/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));

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

// ---- 送ってコンパイルし、表示するドライバも作る --------------------------
const source = readFileSync(SOURCE, "utf8");
const CL = [
  "             PGM",
  `             DCLF       FILE(${LIB}/${MEMBER})`,
  `             SNDRCVF    RCDFMT(RENDERR)`,
  "             ENDPGM"
];

const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try {
  await ifs.writeFile(`${IFS}/${MEMBER}.dds`, new TextEncoder().encode(source), { create: true, truncate: true });
  await ifs.writeFile(`${IFS}/${PROGRAM}.clp`, new TextEncoder().encode(CL.join("\n") + "\n"), { create: true, truncate: true });
} finally { ifs.close(); }

const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
try {
  // **CCSID を指定する。** 既定の 1027 は DBCS を黙って落とす（AGENTS.md / 過去に踏んだ）。
  await cmd.run(`CRTSRCPF FILE(${LIB}/QDDSSRCJ) RCDLEN(112) CCSID(5035) IGCDTA(*YES) TEXT('DDS source (DBCS)')`);
  await cmd.run(`CRTSRCPF FILE(${LIB}/QCLSRC) RCDLEN(112) TEXT('CL source')`);
  await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${MEMBER}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QDDSSRCJ.FILE/${MEMBER}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await cmd.run(`CHGPFM FILE(${LIB}/QDDSSRCJ) MBR(${MEMBER}) SRCTYPE(DSPF)`);
  const built = await cmd.run(`CRTDSPF FILE(${LIB}/${MEMBER}) SRCFILE(${LIB}/QDDSSRCJ) SRCMBR(${MEMBER}) REPLACE(*YES)`);
  if (!built.success) {
    console.error("コンパイルが通りません:", built.messages.map(m => `${m.id} ${m.text}`).join(" / "));
    process.exit(1);
  }
  await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${PROGRAM}.clp') TOMBR('/QSYS.LIB/${LIB}.LIB/QCLSRC.FILE/${PROGRAM}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await cmd.run(`CHGPFM FILE(${LIB}/QCLSRC) MBR(${PROGRAM}) SRCTYPE(CLP)`);
  // **ライブラリー・リストに入れてから作る。** 外部記述ファイルが見つからないと RNF/CPD が出る。
  const pgm = await cmd.run(`CRTBNDCL PGM(${LIB}/${PROGRAM}) SRCFILE(${LIB}/QCLSRC) SRCMBR(${PROGRAM}) REPLACE(*YES)`);
  if (!pgm.success) {
    console.error("ドライバが作れません:", pgm.messages.map(m => `${m.id} ${m.text}`).join(" / "));
    process.exit(1);
  }
} finally { cmd.close(); }

// ---- 画面に出して採る ------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rowsOf = snap => snap.cells.map(r => r.map(c => c.char).join(""));

async function connect() {
  // **装置は自動構成できない**（CPF8940）。既にある装置から選ぶ。
  const pool = ["ASA1", "ASA2", "ASA3", "ASA4", "ASAO3", "ASAO4"];
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const device = pool[attempt % pool.length];
    try {
      const s = await Session5250.connect({
        host: sys.host, port: sys.port ?? 23, ccsid: sys.ccsid ?? 5035,
        screenSize: "24x80", deviceName: device, user: creds.user, password: creds.password
      });
      await sleep(1500);
      const inputs = s.snapshot().fields.filter(f => !f.protected);
      if (inputs.length >= 2) {
        s.setField({ index: inputs[0].index }, creds.user);
        s.setField({ index: inputs[1].index }, creds.password);
        await s.sendAid("Enter", { cursor: { row: inputs[0].row, col: inputs[0].col }, timeoutMs: 15000 });
        await sleep(900);
      }
      for (let i = 0; i < 8; i += 1) {
        const text = rowsOf(s.snapshot());
        if (text.some(r => /選択項目またはコマンド|Selection or command/u.test(r))) return s;
        const snap = s.snapshot();
        if (text.some(r => /対話式ジョブの回復|Display Job Recovery/u.test(r))) {
          const f = snap.fields.filter(x => !x.protected).slice(-1)[0];
          s.setField({ index: f.index }, "90");
          await s.sendAid("Enter", { cursor: { row: f.row, col: f.col }, timeoutMs: 12000 });
        } else {
          await s.sendAid("Enter", { timeoutMs: 10000 });
        }
        await sleep(900);
      }
      s.disconnect();
      throw new Error("コマンド画面まで到達しませんでした");
    } catch (error) {
      last = error;
      process.stderr.write(`connect retry ${attempt + 1} (${device}): ${error.message}\n`);
      await sleep(4000);
    }
  }
  throw last;
}

const session = await connect();
let snapshot;
try {
  const send = async text => {
    const snap = session.snapshot();
    const field = snap.fields.filter(f => !f.protected).slice(-1)[0];
    session.setField({ index: field.index }, text);
    await session.sendAid("Enter", { cursor: { row: field.row, col: field.col }, timeoutMs: 30000 });
    await sleep(700);
    return session.snapshot();
  };
  await send(`ADDLIBLE ${LIB}`);
  snapshot = await send(`CALL ${LIB}/${PROGRAM}`);
  await session.sendAid("F3", { timeoutMs: 20000 });
} finally { session.disconnect(); }

// ---- ゴールデンに書き出す --------------------------------------------------
//
// **桁で引ける形は `cells` だけ。** 画面のセルを繋いだ「行の文字列」は桁と対応しない
// ——全角 1 文字は 2 桁を占めるが、セルは 1 つ目に文字・2 つ目に空文字を持つので、
// 繋ぐと 1 桁ずつ詰まる。実際これで検査が 6 件落ちた（採取ではなく検査側の誤り）。
// 表現を 2 つ持つと必ず取り違えるので、**判定に使うのは `cells` だけ**とし、
// 人が眺める用の `preview` は「桁で引かないこと」を名前で示す。
const cells = [];
snapshot.cells.forEach((row, r) => {
  row.forEach((cell, c) => {
    const plain =
      cell.char === " " && !cell.reverse && !cell.underline && !cell.blink && !cell.nonDisplay;
    if (plain) return;
    cells.push({
      row: r + 1, col: c + 1, char: cell.char,
      color: String(cell.color).toLowerCase(),
      reverse: !!cell.reverse, underline: !!cell.underline,
      blink: !!cell.blink, nonDisplay: !!cell.nonDisplay
    });
  });
});

const golden = {
  source: "RENDER1.dspf",
  note:
    "実機の画面をそのまま採ったもの。手で直さない（capture-render-golden.mjs で採り直す）。" +
    "判定に使うのは cells と fields。preview は人が眺めるためのもので桁と対応しない。",
  capturedAt: new Date().toISOString().slice(0, 10),
  system: `${sys.name ?? sys.id} / 24x80 / CCSID ${sys.ccsid ?? 5035}`,
  preview: rowsOf(snapshot).map(r => r.replace(/\s+$/u, "")),
  cells,
  fields: snapshot.fields.map(f => ({
    row: f.row, col: f.col, length: f.length, protected: !!f.protected
  }))
};

writeFileSync(GOLDEN, JSON.stringify(golden, null, 2) + "\n", "utf8");
console.log(`採取しました: ${GOLDEN}`);
console.log(`  文字のあるセル ${cells.length} 件 / 実機の欄 ${golden.fields.length} 件`);
for (const r of golden.preview) console.log(`|${r}|`);
