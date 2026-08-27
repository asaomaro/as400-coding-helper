#!/usr/bin/env node
/**
 * **`COLOR` / `DSPATR` の解決結果を実機の画面と突き合わせる。**
 *
 * 原典は「無視される組み合わせ」を散文で並べている（`COLOR(YLW)` ＋ `DSPATR(HI)` は
 * HI が無視される、など）。散文から規則を起こすと必ずどこかを取り違えるので、
 * **全通りを実機に出して、画面のセルの属性と突き合わせる**。
 *
 * ts5250 の画面モデルの `Cell` は `color` / `reverse` / `underline` / `blink` /
 * `columnSeparator` / `nonDisplay` をそのまま持つ。これが答え。
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
const MEMBER = "ATTRTST";
const PROGRAM = "ATTRTSTC";

for (const path of [
  join(TS5250, "packages/hostserver/dist/index.js"),
  join(TS5250, "packages/tn5250/dist/index.js"),
  join(TS5250, "profiles.local.json"),
  join(REPO, "vscode-extension/out/core/dds/dspfAttributes.js")
]) {
  if (!existsSync(path)) { console.error(`前提が足りません: ${path}`); process.exit(2); }
}

const { CommandConnection, IfsConnection } = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { Session5250 } = await import(join(TS5250, "packages/tn5250/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const { resolveAppearance } = await import(join(REPO, "vscode-extension/out/core/dds/dspfAttributes.js"));

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

// ---- 検証する組み合わせ --------------------------------------------------
const COLORS = ["GRN", "WHT", "RED", "TRQ", "YLW", "PNK", "BLU"];
const EXTRA = [[], ["RI"], ["UL"], ["RI", "UL"]];
const cases = [];
for (const color of COLORS) {
  for (const extra of EXTRA) {
    cases.push({ color, dspatr: extra });
  }
}
// COLOR を書かない側は CS/HI/BL/RI/UL の全 32 通り。
const FLAGS = ["CS", "HI", "BL", "RI", "UL"];
for (let mask = 0; mask < 32; mask += 1) {
  cases.push({ color: undefined, dspatr: FLAGS.filter((_, i) => mask & (1 << i)) });
}
cases.push({ color: undefined, dspatr: ["ND"] });

const put = (line, column, value) => {
  const a = line.split("");
  for (let i = 0; i < value.length; i += 1) a[column - 1 + i] = value[i];
  return a.join("");
};
const A = () => put(" ".repeat(80), 6, "A");

// 1 桁の定数を 3 桁おきに置く（属性文字が 1 桁前を使う）。
const PER_ROW = 26;
const source = ["     A          R ATTRR", put(A(), 45, "CA03(03)").replace(/ +$/u, "")];
cases.forEach((testCase, index) => {
  const row = 2 + Math.floor(index / PER_ROW);
  const column = 2 + (index % PER_ROW) * 3;
  const keywords =
    (testCase.color ? `COLOR(${testCase.color}) ` : "") +
    (testCase.dspatr.length > 0 ? `DSPATR(${testCase.dspatr.join(" ")})` : "");
  testCase.row = row;
  testCase.column = column;
  testCase.keywords = keywords.trim();
  const line = put(
    put(put(A(), 39, String(row).padStart(3)), 42, String(column).padStart(3)),
    45,
    `'X'${keywords ? ` ${keywords}` : ""}`
  ).replace(/ +$/u, "");
  if (line.length > 80) { console.error(`80 桁を超えた: |${line}|`); process.exit(1); }
  source.push(line);
});

// ---- 送ってコンパイルし、表示するドライバも作る --------------------------
const CL = [
  "             PGM",
  `             DCLF       FILE(${LIB}/${MEMBER})`,
  "             SNDRCVF    RCDFMT(ATTRR)",
  "             ENDPGM"
];

const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try {
  await ifs.writeFile(`${IFS}/${MEMBER}.dds`, new TextEncoder().encode(source.join("\n") + "\n"), { create: true, truncate: true });
  await ifs.writeFile(`${IFS}/${PROGRAM}.clp`, new TextEncoder().encode(CL.join("\n") + "\n"), { create: true, truncate: true });
} finally { ifs.close(); }

const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QDDSSRC) RCDLEN(112) TEXT('DDS source')`);
  await cmd.run(`CRTSRCPF FILE(${LIB}/QCLSRC) RCDLEN(112) TEXT('CL source')`);
  await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${MEMBER}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QDDSSRC.FILE/${MEMBER}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await cmd.run(`CHGPFM FILE(${LIB}/QDDSSRC) MBR(${MEMBER}) SRCTYPE(DSPF)`);
  const built = await cmd.run(`CRTDSPF FILE(${LIB}/${MEMBER}) SRCFILE(${LIB}/QDDSSRC) SRCMBR(${MEMBER}) REPLACE(*YES)`);
  if (!built.success) {
    console.error("コンパイルが通りません:", built.messages.map(m => `${m.id} ${m.text}`).join(" / "));
    process.exit(1);
  }
  await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${PROGRAM}.clp') TOMBR('/QSYS.LIB/${LIB}.LIB/QCLSRC.FILE/${PROGRAM}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await cmd.run(`CHGPFM FILE(${LIB}/QCLSRC) MBR(${PROGRAM}) SRCTYPE(CLP)`);
  const pgm = await cmd.run(`CRTBNDCL PGM(${LIB}/${PROGRAM}) SRCFILE(${LIB}/QCLSRC) SRCMBR(${PROGRAM}) REPLACE(*YES)`);
  if (!pgm.success) {
    console.error("ドライバが作れません:", pgm.messages.map(m => `${m.id} ${m.text}`).join(" / "));
    process.exit(1);
  }
} finally { cmd.close(); }

// ---- 画面に出して属性を読む ----------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rows = snap => snap.cells.map(r => r.map(c => c.char).join("").replace(/\s+$/u, ""));

async function connect() {
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
        const text = rows(s.snapshot());
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

// ---- 突き合わせ ----------------------------------------------------------
const problems = [];
let matched = 0;
for (const testCase of cases) {
  const cell = snapshot.cells[testCase.row - 1]?.[testCase.column - 1];
  if (!cell) { problems.push(`${testCase.keywords || "（なし）"}: 画面のセルが取れない`); continue; }

  const ours = resolveAppearance(`'X' ${testCase.keywords}`);
  // **桁区切り線は比べない。** 原典の 2 つの表で扱いが食い違い、見た目は文字間の細い点で、
  // 原典自身が「行間隔縮小モードにすると消える」と書いている。モデルに入れていない。
  // **非表示なら色は比べない。** 何も出ないので色に意味が無く、
  // 実機（ts5250 の復号表）が非表示のバイトに割り当てている色は基底の色になっている。
  const machine = {
    color: cell.nonDisplay ? "-" : String(cell.color).toLowerCase(),
    reverse: cell.reverse,
    underline: cell.underline,
    blink: cell.blink,
    nonDisplay: cell.nonDisplay
  };
  const mine = {
    color: ours.nonDisplay ? "-" : ours.color,
    reverse: ours.reverse,
    underline: ours.underline,
    blink: ours.blink,
    nonDisplay: ours.nonDisplay
  };

  if (JSON.stringify(machine) === JSON.stringify(mine)) { matched += 1; continue; }
  problems.push(
    `${(testCase.keywords || "（なし）").padEnd(34)} 実機 ${JSON.stringify(machine)} / 本 PJ ${JSON.stringify(mine)}`
  );
}

console.log(`\n組み合わせ ${cases.length} 件 / 一致 ${matched} 件`);
if (problems.length > 0) {
  console.error(`\n✗ 不一致 ${problems.length} 件`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\n✓ 実機の画面属性と一致");
