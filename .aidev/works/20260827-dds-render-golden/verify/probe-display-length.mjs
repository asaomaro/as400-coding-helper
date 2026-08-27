#!/usr/bin/env node
/**
 * **表示桁数の規則を実機のコンパイラ／画面に判定させる。**
 *
 * 原典（`表示装置ファイルの桁数 (30 - 34 桁目)`）:
 * > 画面に表示されるときのフィールドの桁数を **表示桁数** といいます。表示桁数は、
 * > プログラム桁数と同じかまたは**それより大きくなります**。フィールドの表示桁数は、
 * > **キーボード・シフト (35 桁目)** のほか、**小数点以下の桁数 (36 および 37 桁目)** や
 * > **編集機能**などのその他のフィールド仕様によって決まります。
 *
 * 規則の表そのもの（「表示装置ファイルの有効な項目」）はローカルの原典スナップショットに
 * 無い。AGENTS.md「原典と実機が食い違ったら、実機のパーサーに判定させる」に従い、
 * **全通りを画面に出して実機が返す欄の桁数を読む**。
 *
 * 入力可（`I` / `B`）の欄は 5250 が桁数を返すので、そこから読む。
 *
 * 実行:
 *   cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify <このファイル>
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TS5250 = process.env.TS5250_ROOT ?? "/workspaces/ts5250";
const MEMBER = "DSPLEN";
const PROGRAM = "DSPLENC";

for (const p of [
  join(TS5250, "packages/hostserver/dist/index.js"),
  join(TS5250, "packages/tn5250/dist/index.js"),
  join(TS5250, "profiles.local.json")
]) if (!existsSync(p)) { console.error(`前提が足りません: ${p}`); process.exit(2); }

const { CommandConnection, IfsConnection } = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { Session5250 } = await import(join(TS5250, "packages/tn5250/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));

const LIB = process.env.AS400_LIB ?? "TESTLIB";
const IFS = process.env.AS400_IFS_DIR ?? "/home/USER";
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === (process.env.AS400_SYSTEM ?? "SR-OSAKA") || s.name === (process.env.AS400_SYSTEM ?? "SR-OSAKA"));
const creds = {
  host: sys.host, user: sys.signon.user,
  password: process.env.AS400_PASSWORD ?? SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc)
};

// ---- 総当たり ------------------------------------------------------------
// キーボード・シフト（35 桁目）× 小数点以下（36-37）× 用途（38）。
// 桁数は 6 に固定し、返ってくる桁数との差を見る。
// **小数点以下の欄がデータ・タイプを決める**（原典 36-37 桁目）:
// 「この欄をブランクのままにしておいた場合には…データ・タイプとして文字を割り当てます」
// 「この欄に数字を指定した場合には…ゾーン 10 進数であると見なします」
// したがって文字系のシフトは小数点なし、数字系のシフトは小数点ありで組む。
const CHAR_SHIFTS = ["A", "X", "N"];
const NUM_SHIFTS = ["S", "Y"];
const USAGES = ["I", "B"];
const LEN = 6;

const cases = [];
for (const shift of CHAR_SHIFTS) for (const usage of USAGES) cases.push({ shift, dec: null, usage });
// 数字系は出力専用（`O`）も見る。値が 0 なので数字が並び、印字の連なりで測れる。
for (const shift of NUM_SHIFTS) for (const dec of [0, 2]) for (const usage of ["I", "B", "O"]) {
  cases.push({ shift, dec, usage });
}
// 編集（EDTCDE）の効果も見る。**シフトは Y だけ**——原典（36-37 桁目）が
// 「編集が効力を持っている場合は、キーボード・シフトは数字のみ (35 桁目が Y)」と
// 定めており、`S` ＋ 編集は矛盾する。
cases.push({ shift: "Y", dec: 2, usage: "B", kw: "EDTCDE(J)" });
cases.push({ shift: "Y", dec: 2, usage: "O", kw: "EDTCDE(J)" });

const put = (line, col, v) => { const a=line.split(""); for(let i=0;i<v.length;i+=1) a[col-1+i]=v[i]; return a.join(""); };
const A = () => put(" ".repeat(80), 6, "A");

// 1 行 1 欄。24 行に収めるため 20 件ずつに割って複数の様式にする。
const PER_SCREEN = 20;
const screens = [];
for (let i = 0; i < cases.length; i += PER_SCREEN) screens.push(cases.slice(i, i + PER_SCREEN));

const src = [];
screens.forEach((group, gi) => {
  src.push(put(put(A(), 17, "R"), 19, `LENR${gi + 1}`).replace(/ +$/u, "") .padEnd(45).slice(0,45).replace(/ +$/u,"") );
  src[src.length - 1] = put(put(put(A(), 17, "R"), 19, `LENR${gi + 1}`), 45, "CA03(03)").replace(/ +$/u, "");
  group.forEach((c, i) => {
    const row = i + 2;
    c.screen = gi + 1; c.row = row; c.column = 30; c.name = `F${gi + 1}${String(i).padStart(2, "0")}`;
    let l = put(A(), 19, c.name);
    l = put(l, 30, String(LEN).padStart(5));
    l = put(l, 35, c.shift);
    if (c.dec !== null) l = put(l, 36, String(c.dec).padStart(2));
    l = put(l, 38, c.usage);
    l = put(l, 39, String(row).padStart(3));
    l = put(l, 42, String(c.column).padStart(3));
    if (c.kw) l = put(l, 45, c.kw);
    l = l.replace(/ +$/u, "");
    if (l.length > 80) { console.error("80 桁超過"); process.exit(1); }
    src.push(l);
    // 目印の定数（どの行がどの条件かを画面で読めるように）
    const label = `${c.shift}${c.dec === null ? "-" : c.dec}${c.usage}${c.kw ? "E" : ""}`;
    src.push(put(put(put(A(), 39, String(row).padStart(3)), 42, "  2"), 45, `'${label}'`).replace(/ +$/u, ""));
  });
});

if (process.env.DRY) {
  src.forEach((l, i) => console.log(String(i + 1).padStart(3), `|${l}|`));
  process.exit(0);
}

const CL = ["             PGM", `             DCLF       FILE(${LIB}/${MEMBER})`];
screens.forEach((_, gi) => CL.push(`             SNDRCVF    RCDFMT(LENR${gi + 1})`));
CL.push("             ENDPGM");

const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try {
  await ifs.writeFile(`${IFS}/${MEMBER}.dds`, new TextEncoder().encode(src.join("\n") + "\n"), { create: true, truncate: true });
  await ifs.writeFile(`${IFS}/${PROGRAM}.clp`, new TextEncoder().encode(CL.join("\n") + "\n"), { create: true, truncate: true });
} finally { ifs.close(); }

const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
try {
  await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${MEMBER}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QDDSSRCJ.FILE/${MEMBER}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await cmd.run(`CHGPFM FILE(${LIB}/QDDSSRCJ) MBR(${MEMBER}) SRCTYPE(DSPF)`);
  const built = await cmd.run(`CRTDSPF FILE(${LIB}/${MEMBER}) SRCFILE(${LIB}/QDDSSRCJ) SRCMBR(${MEMBER}) REPLACE(*YES)`);
  if (!built.success) { console.error("CRTDSPF NG:", built.messages.map(m => `${m.id} ${m.text}`).join(" / ")); process.exit(1); }
  await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${PROGRAM}.clp') TOMBR('/QSYS.LIB/${LIB}.LIB/QCLSRC.FILE/${PROGRAM}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await cmd.run(`CHGPFM FILE(${LIB}/QCLSRC) MBR(${PROGRAM}) SRCTYPE(CLP)`);
  const pgm = await cmd.run(`CRTBNDCL PGM(${LIB}/${PROGRAM}) SRCFILE(${LIB}/QCLSRC) SRCMBR(${PROGRAM}) REPLACE(*YES)`);
  if (!pgm.success) { console.error("CRTBNDCL NG:", pgm.messages.map(m => `${m.id} ${m.text}`).join(" / ")); process.exit(1); }
} finally { cmd.close(); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rowsOf = s => s.cells.map(r => r.map(c => c.char).join(""));
async function connect() {
  const pool = ["ASA1", "ASA2", "ASA3", "ASA4", "ASAO3", "ASAO4"];
  let last;
  for (let a = 0; a < 6; a += 1) {
    try {
      const s = await Session5250.connect({ host: sys.host, port: sys.port ?? 23, ccsid: sys.ccsid ?? 5035,
        screenSize: "24x80", deviceName: pool[a % pool.length], user: creds.user, password: creds.password });
      await sleep(1500);
      const inputs = s.snapshot().fields.filter(f => !f.protected);
      if (inputs.length >= 2) {
        s.setField({ index: inputs[0].index }, creds.user);
        s.setField({ index: inputs[1].index }, creds.password);
        await s.sendAid("Enter", { cursor: { row: inputs[0].row, col: inputs[0].col }, timeoutMs: 15000 });
        await sleep(900);
      }
      for (let i = 0; i < 8; i += 1) {
        const t = rowsOf(s.snapshot());
        if (t.some(r => /選択項目またはコマンド|Selection or command/u.test(r))) return s;
        const snap = s.snapshot();
        if (t.some(r => /対話式ジョブの回復|Display Job Recovery/u.test(r))) {
          const f = snap.fields.filter(x => !x.protected).slice(-1)[0];
          s.setField({ index: f.index }, "90");
          await s.sendAid("Enter", { cursor: { row: f.row, col: f.col }, timeoutMs: 12000 });
        } else await s.sendAid("Enter", { timeoutMs: 10000 });
        await sleep(900);
      }
      s.disconnect(); throw new Error("到達できず");
    } catch (e) { last = e; process.stderr.write(`retry ${a + 1}: ${e.message}\n`); await sleep(4000); }
  }
  throw last;
}

const session = await connect();
const seen = [];
try {
  const send = async text => {
    const snap = session.snapshot();
    const f = snap.fields.filter(x => !x.protected).slice(-1)[0];
    session.setField({ index: f.index }, text);
    await session.sendAid("Enter", { cursor: { row: f.row, col: f.col }, timeoutMs: 30000 });
    await sleep(800);
    return session.snapshot();
  };
  await send(`ADDLIBLE ${LIB}`);
  let snap = await send(`CALL ${LIB}/${PROGRAM}`);
  for (let gi = 0; gi < screens.length; gi += 1) {
    seen.push({
      fields: snap.fields.map(f => ({ row: f.row, col: f.col, length: f.length, protected: !!f.protected })),
      rows: rowsOf(snap).map(r => r.padEnd(80, " "))
    });
    if (gi < screens.length - 1) { await session.sendAid("Enter", { timeoutMs: 20000 }); await sleep(800); snap = session.snapshot(); }
  }
  await session.sendAid("F3", { timeoutMs: 20000 });
} finally { session.disconnect(); }

/**
 * 出力専用（`O`）の欄は 5250 の欄一覧に出ない（保護されていて入力できないため）。
 * **印字された文字の連なり**で測る——値は 0 なので数字が並び、編集が効けば
 * 小数点やコンマも入る。文字系のシフトは値が空白なので測れない（`-` になる）。
 */
function printedRun(rows, row, column) {
  const line = rows[row - 1] ?? "";
  let end = column - 1;
  while (end < line.length && line[end] !== " ") end += 1;
  return end - (column - 1);
}

console.log("shift dec use kw        宣言 実機 差  測り方");
for (const c of cases) {
  const screen = seen[c.screen - 1];
  const f = (screen?.fields ?? []).find(x => x.row === c.row && x.col === c.column);
  let got = "-", how = "";
  if (f) { got = f.length; how = "欄"; }
  else if (screen) {
    const run = printedRun(screen.rows, c.row, c.column);
    if (run > 0) { got = run; how = "印字"; }
  }
  const diff = typeof got === "number" ? got - LEN : "-";
  console.log(
    `${c.shift.padEnd(5)} ${String(c.dec ?? "-").padEnd(3)} ${c.usage.padEnd(3)} ${(c.kw ?? "").padEnd(10)} ${String(LEN).padStart(3)} ${String(got).padStart(4)} ${String(diff).padStart(2)}  ${how}`
  );
}
