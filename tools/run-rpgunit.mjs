#!/usr/bin/env node
/**
 * RPGUnit のテストを 1 コマンドで回して結果を採る。
 *
 *   node tools/run-rpgunit.mjs <ソース> [--pgm 名前] [--srctype RPGLE|SQLRPGLE]
 *                                       [--xml <保存先>] [--json] [--keep]
 *
 * 転送 → ビルド → 実行 → 結果採取。終了コードは 0=全合格 / 1=テスト失敗 / 2=道具の異常。
 *
 * ■ なぜ道具にしたか
 *   手順は skill `rpgunit-test` にあるが、実行するたびに使い捨てのスクリプトを
 *   書いていた（.aidev/works/ に 65 本）。接続の型・完了待ち・スプールの引数名を
 *   書き直すたびに同じ罠を踏む。踏む場所をここ 1 か所に閉じ込める。
 *
 * ■ 閉じ込めてある罠（利用者は知らなくてよい）
 *   - SRCMBR はプログラム名と揃える（別名は CPF9815。getMemberType がプログラム名で探す）
 *   - CHGPFM SRCTYPE(SQLRPGLE) を忘れると RPGLE として扱われて落ちる
 *   - SBMJOB に INLLIBL(RPGUNIT …) と INQMSGRPY(*DFT) が要る
 *     （後者が無いと監視漏れの例外が照会になりジョブが MSGW で残る）
 *   - CL の中では RPGUNIT/ で修飾する（解決はコンパイル時）
 *   - 既定 20 秒のソケット時間切れでは RUCRTRPG が終わらない
 *   - 結果のスプール名は RPGUNIT、コンパイル・リストはプログラム名
 *
 * ■ 前提
 *   /workspaces/ts5250 のチェックアウトと、そこの --env-file。
 *     cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify \
 *       /path/to/tools/run-rpgunit.mjs <ソース>
 *   .env の中身は読まない（あちらの規約）。識別子は .env.verify から取る。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const TS5250 = process.env.TS5250_DIR ?? "/workspaces/ts5250";

// ---------------------------------------------------------------- 純粋な部分
// 実機に触らない。--self-test で確かめる。

const USAGE = `使い方: node tools/run-rpgunit.mjs <ソースファイル> [オプション]

  --pgm <名前>        テストプログラム名（既定: ソースのファイル名）
                      ソースメンバー名も同じになる（RUCRTRPG の制約）
  --srctype <型>      RPGLE | SQLRPGLE（既定: 拡張子から判定）
  --lib <ライブラリー>  既定: 環境変数 AS400_LIB
  --srcfile <名前>    ソース物理ファイル（既定: QUNITSRC。無ければ作る）
  --bnd <lib/名前>    テスト対象のサービスプログラム（繰り返し可）
                      テスト対象のビルドは利用者側の仕事。ここでは束ねるだけ
  --xml <パス>        JUnit XML の保存先（ローカル）
  --json              要約を JSON で出す（自律ループ向け）
  --keep              IFS の作業ファイルを消さない
  --order <api|reverse>       RUCALLTST の ORDER（既定 api）
  --rclrsc <no|always|once>   RUCALLTST の RCLRSC（既定 no）
  --check-independence        正順と逆順を両方走らせ、合否が食い違えば失敗にする
                              （設計書 4.2 の「逆順実行」検品）
  --no-tgtccsid       TGTCCSID(0) を渡さない（v4.0.3.r 以前の版で使う）
  --self-test         実機に触らず、純粋な部分だけ確かめる
  --help
`;

class UsageError extends Error {}

/** 拡張子からソースタイプを決める。SQL 組み込みだけ別扱い。 */
export function srcTypeFromExt(file) {
  const ext = extname(file).toLowerCase();
  return ext === ".sqlrpgle" || ext === ".sqlrpg" ? "SQLRPGLE" : "RPGLE";
}

export function parseArgs(argv) {
  const o = { keep: false, json: false, selfTest: false, srcfile: "QUNITSRC", bnd: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new UsageError(`${a} に値がありません`);
      i += 1;
      return v;
    };
    switch (a) {
      case "--help": case "-h": throw new UsageError("");
      case "--pgm": o.pgm = next(); break;
      case "--srctype": {
        const v = next().toUpperCase();
        if (v !== "RPGLE" && v !== "SQLRPGLE") throw new UsageError(`--srctype は RPGLE か SQLRPGLE です: ${v}`);
        o.srctype = v; break;
      }
      case "--lib": o.lib = next(); break;
      case "--srcfile": o.srcfile = next().toUpperCase(); break;
      case "--bnd": {
        const v = next().toUpperCase();
        // lib/name か name。RUCRTRPG の BNDSRVPGM は修飾名を取る。
        if (!/^([A-Z0-9$#@_.]{1,10}\/)?[A-Z0-9$#@_.]{1,10}$/.test(v))
          throw new UsageError(`--bnd は <ライブラリー>/<名前> か <名前> です: ${v}`);
        o.bnd.push(v);
        break;
      }
      case "--xml": o.xml = next(); break;
      case "--json": o.json = true; break;
      case "--keep": o.keep = true; break;
      case "--self-test": o.selfTest = true; break;
      case "--no-tgtccsid": o.noTgtCcsid = true; break;  // v4.0.3.r 以前（TGTCCSID が無い版）
      case "--order": {
        const v = next().toLowerCase();
        if (v !== "api" && v !== "reverse") throw new UsageError(`--order は api か reverse です: ${v}`);
        o.order = v; break;
      }
      case "--rclrsc": {
        const v = next().toLowerCase();
        if (!["no", "always", "once"].includes(v)) throw new UsageError(`--rclrsc は no / always / once です: ${v}`);
        o.rclrsc = v; break;
      }
      case "--check-independence": o.checkIndependence = true; break;
      default:
        if (a.startsWith("-")) throw new UsageError(`知らないオプションです: ${a}`);
        if (o.source) throw new UsageError("ソースファイルは 1 つだけです");
        o.source = a;
    }
  }
  if (o.selfTest) return o;
  if (!o.source) throw new UsageError("ソースファイルを指定してください");
  // **メンバー名はプログラム名と同じにする。** 別名だと getMemberType が
  // プログラム名のメンバーを探して CPF9815 になる（実測）。選ばせない。
  o.pgm ??= basename(o.source, extname(o.source)).toUpperCase();
  o.pgm = o.pgm.toUpperCase();
  o.srctype ??= srcTypeFromExt(o.source);
  return o;
}

/** v6 は本文を CDATA で包む（v4 は素）。両方を読めるようにする。 */
function stripCdata(t) {
  const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(t);
  return m ? m[1] : t;
}

/** **`&amp;` は最後**（先に戻すと `&amp;apos;` が壊れる）。 */
function unescapeXml(t) {
  return t.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

/** 失敗した場所（`NAME (PGM->MODULE:NNN)`）を本文から拾う。無ければ先頭行。 */
function failureLocation(detail) {
  const m = /^\s*(\S+\s+\([^)]*:\d+\))\s*$/m.exec(detail);
  return m ? m[1] : (detail.split("\n").find(l => l.trim()) ?? "").trim();
}

/** JUnit XML から件数と失敗の内訳を取り出す。実機が出したものをそのまま読む。 */
export function summarize(xml) {
  const suite = /<testsuite\b([^>]*)>/.exec(xml);
  const attr = (s, k) => {
    const m = new RegExp(`\\b${k}="([^"]*)"`).exec(s ?? "");
    return m ? m[1] : "";
  };
  const num = (s, k) => Number(attr(s, k) || 0);
  const head = suite?.[1] ?? "";
  const cases = [];
  // <testcase …/> と <testcase …> … </testcase> の両方を拾う
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const c = { name: attr(m[1], "name"), classname: attr(m[1], "classname"),
      assertions: num(m[1], "assertions"), time: attr(m[1], "time") };
    const body = m[3] ?? "";
    const f = /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>/.exec(body);
    if (f) {
      c.failure = { kind: f[1], message: unescapeXml(attr(f[2], "message")),
        detail: unescapeXml(stripCdata(f[3])).trim() };
    }
    cases.push(c);
  }
  return { name: attr(head, "name"), tests: num(head, "tests"),
    failures: num(head, "failures"), errors: num(head, "errors"), cases };
}

/**
 * 2 回の実行を突き合わせ、**合否が食い違うテスト**を返す。
 *
 * **比べるのは合否だけ。** 実行時間・並び順・メッセージの文言は毎回変わるので
 * 差として扱わない（扱うと毎回「食い違い」になって検査が意味を失う）。
 * 片方にしか無いテストも食い違いとする（順序で件数が変わるのは異常）。
 */
export function compareRuns(a, b) {
  const ok = r => new Map(r.cases.map(c => [c.name, c.failure ? "失敗" : "合格"]));
  const A = ok(a), B = ok(b);
  const names = [...new Set([...A.keys(), ...B.keys()])].sort();
  return names
    .map(name => ({ name, a: A.get(name) ?? "無し", b: B.get(name) ?? "無し" }))
    .filter(d => d.a !== d.b);
}

/** 人が読む要約。 */
function render(s) {
  const out = [];
  for (const c of s.cases) {
    if (!c.failure) continue;
    const where = failureLocation(c.failure.detail);
    out.push(`  ✗ ${c.name}  ${c.failure.message || where}`);
    if (c.failure.message && where) out.push(`      ${where}`);
  }
  const bad = s.failures + s.errors;
  out.push("");
  out.push(`${bad > 0 ? "FAILURE" : "SUCCESS"}  ${s.tests} tests, ${s.failures} failure, ${s.errors} error`);
  return out.join("\n");
}

// ---------------------------------------------------------------- 実機の部分

function requireEnv() {
  const missing = [];
  if (!existsSync(join(TS5250, "packages/hostserver/dist/index.js")))
    missing.push(`${TS5250}/packages/hostserver/dist/index.js（ts5250 のチェックアウトとビルド）`);
  if (!existsSync(join(TS5250, "profiles.local.json")))
    missing.push(`${TS5250}/profiles.local.json`);
  for (const k of ["AS400_SYSTEM", "AS400_LIB", "AS400_IFS_DIR"])
    if (!process.env[k]) missing.push(`環境変数 ${k}`);
  if (missing.length) {
    console.error("✗ 前提が足りません:");
    for (const m of missing) console.error(`    - ${m}`);
    console.error("\n  次の形で起動してください（.env の中身は読みません）:");
    console.error("    cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify \\");
    console.error("      <このリポジトリ>/tools/run-rpgunit.mjs <ソース>");
    return false;
  }
  return true;
}

async function connectAll() {
  const hs = await import(join(TS5250, "packages/hostserver/dist/index.js"));
  const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
  const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
  const want = process.env.AS400_SYSTEM;
  const sys = profiles.systems.find(s => s.id === want || s.name === want);
  if (!sys) throw new Error(`profiles.local.json に ${want} がありません`);
  const creds = { host: sys.host, user: sys.signon.user,
    password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
  return { hs, creds, user: String(sys.signon.user).toUpperCase() };
}

/** ジョブが消えるまで待つ。SBMJOB は投げっぱなしなので消滅で判断する。 */
async function waitJob(hs, creds, jobName, seconds = 180) {
  const db = await hs.DbConnection.connect({ ...creds, resolvePort: true, timeoutMs: 60000 });
  try {
    for (let i = 0; i < Math.ceil(seconds / 5); i += 1) {
      await new Promise(r => setTimeout(r, 5000));
      const r = await hs.query(db,
        `SELECT JOB_NAME FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO=>'NONE'))
          WHERE UPPER(JOB_NAME) LIKE '%${jobName}%'`);
      if (!(r.rows ?? r).length) return true;
    }
    return false;
  } finally { db.close(); }
}

/** 失敗したときに「次に読む先」を出す。スプールは消さない。 */
async function reportSpools(hs, creds, user, jobName) {
  const db = await hs.DbConnection.connect({ ...creds, resolvePort: true, timeoutMs: 60000 });
  try {
    const r = await hs.query(db,
      `SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
        WHERE USER_NAME='${user}' AND JOB_NAME LIKE '%${jobName}%' ORDER BY CREATE_TIMESTAMP`);
    const rows = r.rows ?? r;
    if (!rows.length) return;
    console.error("  次に読む先（スプールは消していません）:");
    for (const x of rows)
      console.error(`    ${x.SPOOLED_FILE_NAME} #${x.FILE_NUMBER}  JOB(${x.JOB_NAME})`);
  } finally { db.close(); }
}

async function objectExists(hs, creds, lib, name) {
  const db = await hs.DbConnection.connect({ ...creds, resolvePort: true, timeoutMs: 60000 });
  try {
    const r = await hs.query(db,
      `SELECT OBJNAME FROM TABLE(QSYS2.OBJECT_STATISTICS('${lib}','*ALL')) WHERE OBJNAME='${name}'`);
    return (r.rows ?? r).length > 0;
  } finally { db.close(); }
}

async function main(argv) {
  let o;
  try { o = parseArgs(argv); }
  catch (e) {
    if (e instanceof UsageError) { if (e.message) console.error(`✗ ${e.message}\n`); console.error(USAGE); return e.message ? 2 : 0; }
    throw e;
  }

  if (o.selfTest) return selfTest();
  if (!requireEnv()) return 2;
  if (!existsSync(o.source)) { console.error(`✗ ソースがありません: ${o.source}`); return 2; }

  const LIB = (o.lib ?? process.env.AS400_LIB).toUpperCase();
  const IFS = process.env.AS400_IFS_DIR;
  const stamp = Date.now().toString(36).slice(-5).toUpperCase();
  const buildJob = `RUB${stamp}`.slice(0, 10);
  const runJob = `RUR${stamp}`.slice(0, 10);
  const ifsSrc = `${IFS}/${o.pgm}.src`;
  const ifsXml = `${IFS}/${o.pgm}.xml`;

  const { hs, creds, user } = await connectAll();
  let code = 2;
  try {
    // --- 転送 ---
    const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true, timeoutMs: 120000 });
    try {
      await ifs.writeFile(ifsSrc, new Uint8Array(readFileSync(o.source)), { create: true, truncate: true });
    } finally { ifs.close(); }

    const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true, timeoutMs: 120000 });
    try {
      await cmd.run(`CRTSRCPF FILE(${LIB}/${o.srcfile}) RCDLEN(112) CCSID(5035) IGCDTA(*YES)`); // 既存なら CPF7302
      const cpy = await cmd.run(`CPYFRMSTMF FROMSTMF('${ifsSrc}') ` +
        `TOMBR('/QSYS.LIB/${LIB}.LIB/${o.srcfile}.FILE/${o.pgm}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
      if (!cpy.success) { console.error("✗ メンバーに書けません"); for (const m of cpy.messages ?? []) console.error(`    ${m.id} ${m.text}`); return 2; }
      await cmd.run(`CHGPFM FILE(${LIB}/${o.srcfile}) MBR(${o.pgm}) SRCTYPE(${o.srctype})`);
      console.log(`▸ 転送     ${basename(o.source)} → ${LIB}/${o.srcfile}(${o.pgm})  [${o.srctype}]` +
        (o.bnd.length ? `  bind: ${o.bnd.join(" ")}` : ""));

      // --- ビルド ---
      const t0 = Date.now();
      // BNDSRVPGM は MAX(50) のリストで、修飾は `library/name`（原典 RPGUNIT/QCMD,RUCRTRPG）。
      // 空白区切りにすると 2 つの要素として読まれる。1 つも無ければ付けない（既定 *NONE）。
      const bnd = o.bnd.length
        ? ` BNDSRVPGM(${o.bnd.map(b => (b.includes("/") ? b : `${LIB}/${b}`)).join(" ")})`
        : "";
      // **TGTCCSID(0) を必ず渡す。** v5 以降の RUCRTRPG は既定（*SRC）だと
      // CRTRPGMOD に TGTCCSID を付けるが、IBM i 7.3 の CRTRPGMOD にその
      // キーワードは無く CPD0043 で落ちる。CRTTST.RPGLE の serializeTgtCcsid は
      // `if (tgtCcsid = 0) return '';` なので、0 を渡せばキーワードごと消える。
      // v4 には TGTCCSID パラメータ自体が無いので、その場合は付けない。
      const tgt = o.noTgtCcsid ? "" : " TGTCCSID(0)";
      const sub = await cmd.run(`SBMJOB CMD(RPGUNIT/RUCRTRPG TSTPGM(${LIB}/${o.pgm}) SRCFILE(${LIB}/${o.srcfile}) ` +
        `SRCMBR(${o.pgm})${bnd}${tgt}) JOB(${buildJob}) INLLIBL(RPGUNIT ${LIB} QGPL QTEMP) INQMSGRPY(*DFT)`);
      // **投入自体の失敗を見る。** 見ないと、走らなかったものを「ビルド失敗」と報告して
      // 本当の理由（コマンドの書式など）が消える。
      if (!sub.success) {
        console.error("✗ ビルドを投入できません");
        for (const m of sub.messages ?? []) console.error(`    ${m.id} ${m.text}`);
        return 2;
      }
      if (!await waitJob(hs, creds, buildJob)) { console.error(`✗ ビルドが終わりません JOB(${buildJob})`); return 2; }
      if (!await objectExists(hs, creds, LIB, o.pgm)) {
        console.error(`✗ ビルド失敗   ${o.pgm} が作成されませんでした`);
        await reportSpools(hs, creds, user, buildJob);
        return 2;
      }
      console.log(`▸ ビルド   ${o.pgm} … OK (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

      // --- 実行 ---
      // 1 回走らせて結果を採る。--check-independence では順序を変えて 2 回呼ぶ。
      const runOnce = async (order, tag) => {
        const job = `${runJob}${tag}`.slice(0, 10);
        const opts = ` ORDER(*${order.toUpperCase()})` +
          (o.rclrsc ? ` RCLRSC(*${o.rclrsc.toUpperCase()})` : "");
        const sub2 = await cmd.run(`SBMJOB CMD(RPGUNIT/RUCALLTST TSTPGM(${LIB}/${o.pgm}) OUTPUT(*NONE) ` +
          `XMLSTMF('${ifsXml}')${opts}) JOB(${job}) INLLIBL(RPGUNIT ${LIB} QGPL QTEMP) INQMSGRPY(*DFT)`);
        if (!sub2.success) {
          console.error("✗ 実行を投入できません");
          for (const m of sub2.messages ?? []) console.error(`    ${m.id} ${m.text}`);
          return null;
        }
        if (!await waitJob(hs, creds, job)) { console.error(`✗ 実行が終わりません JOB(${job})`); return null; }
        const i2 = await hs.IfsConnection.connect({ ...creds, resolvePort: true, timeoutMs: 120000 });
        try { return new TextDecoder().decode(await i2.readFile(ifsXml)); }
        catch { console.error(`✗ 結果の XML がありません: ${ifsXml}`); await reportSpools(hs, creds, user, job); return null; }
        finally { i2.close(); }
      };

      const t1 = Date.now();
      const xml = await runOnce(o.order ?? "api", "A");
      if (xml === null) return 2;
      const s = summarize(xml);

      // --- 独立性の検品（設計書 4.2 の「逆順実行」）---
      if (o.checkIndependence) {
        const xmlR = await runOnce("reverse", "R");
        if (xmlR === null) return 2;
        const sR = summarize(xmlR);
        const diff = compareRuns(s, sR);
        console.log(`▸ 独立性   正順 ${s.failures + s.errors} 失敗 / 逆順 ${sR.failures + sR.errors} 失敗` +
          `  … ${diff.length ? "**食い違いあり**" : "一致"}`);
        if (diff.length) {
          console.log("");
          console.log("  正順と逆順で合否が違うテスト（順序に依存している）:");
          for (const d of diff) console.log(`    ✗ ${d.name}  正順=${d.a} / 逆順=${d.b}`);
          console.log("");
          console.log("  前のテストが残したもの（DB の行・活動化グループのグローバル・");
          console.log("  ジョブログのメッセージ）を tearDown で片付けているか確かめてください。");
          return 1;
        }
      }
      console.log(`▸ 実行     ${o.pgm} … ${s.tests} tests, ${s.failures} failure (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
      console.log("");
      if (o.json) console.log(JSON.stringify(s, null, 2));
      else console.log(render(s));
      if (o.xml) { writeFileSync(resolve(o.xml), xml, "utf8"); console.log(`\n  XML: ${resolve(o.xml)}`); }
      code = s.failures + s.errors > 0 ? 1 : 0;
    } finally {
      // --- 後始末（IFS のみ。スプールは消さない） ---
      if (!o.keep) {
        try {
          for (const f of [ifsSrc, ifsXml]) await cmd.run(`RMVLNK OBJLNK('${f}')`);
        } catch { /* 後始末の失敗で結果を握り潰さない */ }
      }
      cmd.close();
    }
  } catch (e) {
    console.error(`✗ ${e.message}`);
    return 2;
  }
  return code;
}

// ---------------------------------------------------------------- self-test

function selfTest() {
  let ng = 0;
  const eq = (got, want, label) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
    if (!ok) ng += 1;
  };

  console.log("引数の解決");
  eq(parseArgs(["a/FIXTST2.rpgle"]).pgm, "FIXTST2", "--pgm 省略時はファイル名（大文字）");
  eq(parseArgs(["a/FIXTST2.rpgle"]).srctype, "RPGLE", "拡張子 .rpgle → RPGLE");
  eq(parseArgs(["a/x.sqlrpgle"]).srctype, "SQLRPGLE", "拡張子 .sqlrpgle → SQLRPGLE");
  eq(parseArgs(["a/x.sqlrpg"]).srctype, "SQLRPGLE", "拡張子 .sqlrpg → SQLRPGLE");
  eq(parseArgs(["a/x.rpgle", "--srctype", "sqlrpgle"]).srctype, "SQLRPGLE", "--srctype が拡張子に優先する");
  eq(parseArgs(["a/x.rpgle", "--pgm", "other"]).pgm, "OTHER", "--pgm は大文字化される");
  eq(parseArgs(["a/x.rpgle"]).srcfile, "QUNITSRC", "ソース PF の既定");
  eq(parseArgs(["a/x.rpgle"]).bnd, [], "--bnd 省略時は空（既定 *NONE）");
  eq(parseArgs(["a/x.rpgle", "--bnd", "mylib/calcsrv"]).bnd, ["MYLIB/CALCSRV"], "--bnd は大文字化される");
  eq(parseArgs(["a/x.rpgle", "--bnd", "A", "--bnd", "B"]).bnd, ["A", "B"], "--bnd は繰り返せる");
  eq((() => { try { parseArgs(["a/x.rpgle", "--bnd", "a/b/c"]); return "通った"; }
      catch (e) { return e instanceof UsageError ? "弾いた" : "別の例外"; } })(),
     "弾いた", "--bnd の不正な形は弾く");

  console.log("summarize（実機が出した XML の実物）");
  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuite errors="0" failures="1" hostname="" id="0" name="ASAOLIB/MSGTST" tests="2" >
    <testcase name="TESTASCII" assertions="0" classname="MSGTST" time="0.001" >
        <failure message="ASCII failure text">
TESTASCII (MSGTST-&gt;MSGTST:500)
        </failure>
    </testcase>
    <testcase name="TESTOK" assertions="1" classname="MSGTST" time="0.000" >
    </testcase>
</testsuite>`;
  const s = summarize(xml);
  eq([s.name, s.tests, s.failures, s.errors], ["ASAOLIB/MSGTST", 2, 1, 0], "見出しの件数");
  eq(s.cases.length, 2, "テストケースを 2 件拾う");
  eq(s.cases[0].failure.message, "ASCII failure text", "failure の message");
  eq(s.cases[0].failure.detail, "TESTASCII (MSGTST->MSGTST:500)", "failure の本文（&gt; を戻す）");
  eq(s.cases[1].failure, undefined, "合格したケースに failure は無い");
  eq(summarize(`<testsuite errors="0" failures="0" name="X" tests="1"><testcase name="A" classname="X" time="0"/></testsuite>`).cases.length,
     1, "自己終了タグの <testcase …/> も拾う");

  console.log("引数の解決（独立性の検品）");
  eq(parseArgs(["a/x.rpgle"]).order, undefined, "--order 省略時は未指定（既定 api を後段で当てる）");
  eq(parseArgs(["a/x.rpgle", "--order", "REVERSE"]).order, "reverse", "--order は小文字化される");
  eq(parseArgs(["a/x.rpgle", "--check-independence"]).checkIndependence, true, "--check-independence");
  eq(parseArgs(["a/x.rpgle", "--rclrsc", "ALWAYS"]).rclrsc, "always", "--rclrsc は小文字化される");
  eq((() => { try { parseArgs(["a/x.rpgle", "--order", "random"]); return "通った"; }
      catch (e) { return e instanceof UsageError ? "弾いた" : "別の例外"; } })(),
     "弾いた", "--order の不正値は弾く");

  console.log("compareRuns（合否だけを比べる）");
  const mk = cases => ({ cases: cases.map(([name, bad]) => ({ name, ...(bad ? { failure: { message: "x", detail: "" } } : {}) })) });
  eq(compareRuns(mk([["A", false], ["B", false]]), mk([["B", false], ["A", false]])), [],
     "並び順が違うだけなら食い違いではない");
  eq(compareRuns(mk([["A", false], ["B", false]]), mk([["A", false], ["B", true]])),
     [{ name: "B", a: "合格", b: "失敗" }], "合否が違えば食い違い");
  eq(compareRuns(mk([["A", false]]), mk([["A", false], ["B", false]])),
     [{ name: "B", a: "無し", b: "合格" }], "片方にしか無いテストも食い違い");

  console.log("summarize（v6 形式: CDATA ＋ &apos;）");
  const v6 = `<testsuite errors="0" failures="1" name="ASAOLIB/V2TST" tests="1">
  <testcase name="TESTNG" assertions="1" classname="V2TST" time="1.29" timeUnit="s">
    <failure message="Expected &apos;2&apos;, but was &apos;3&apos;."><![CDATA[
Callstack:
  TESTNG (V2TST->V2TST:1300)

Expected:
  2,00000000000000000000
]]></failure>
  </testcase>
</testsuite>`;
  const s6 = summarize(v6);
  eq(s6.cases[0].failure.message, "Expected '2', but was '3'.", "message の &apos; を戻す");
  eq(s6.cases[0].failure.detail.startsWith("Callstack:"), true, "本文の CDATA を剥がす");
  eq(failureLocation(s6.cases[0].failure.detail), "TESTNG (V2TST->V2TST:1300)", "本文から失敗位置を拾う");
  eq(unescapeXml("&amp;apos;"), "&apos;", "&amp; を最後に戻す（&amp;apos; を壊さない）");

  console.log(ng === 0 ? "\nself-test OK" : `\nself-test NG（${ng} 件）`);
  return ng === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main(process.argv.slice(2)));
}
