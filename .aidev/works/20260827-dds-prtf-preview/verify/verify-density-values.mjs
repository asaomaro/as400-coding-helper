#!/usr/bin/env node
/**
 * **CPI / LPI に書ける値を実機のコンパイラに判定させる。**
 *
 * 原典の「キーワードの形式」から生成した集合（`CPI(10|15)` / `LPI(4|6|8|9|12)`）が
 * 実機と一致するかを、**通る値と通らない値の両方**で確かめる。
 * 通る値だけを試すと「集合が広すぎる」誤りに気づけない。
 *
 * 判定は副作用の無い形——`QTEMP` へのコンパイルで、オブジェクトを残さない。
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
const MEMBER = "DENSTST";

for (const path of [
  join(TS5250, "packages/hostserver/dist/index.js"),
  join(TS5250, "profiles.local.json"),
  join(REPO, "vscode-extension/out/core/dds/prtfDensity.js")
]) {
  if (!existsSync(path)) { console.error(`前提が足りません: ${path}`); process.exit(2); }
}

const { CommandConnection, IfsConnection } = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const { CPI_VALUES, LPI_VALUES } = await import(join(REPO, "vscode-extension/out/core/dds/prtfDensity.js"));

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

const put = (line, column, value) => {
  const a = line.split("");
  for (let i = 0; i < value.length; i += 1) a[column - 1 + i] = value[i];
  return a.join("");
};
const A = () => put(" ".repeat(80), 6, "A");

/** 試す値。**原典に無い値も混ぜる**（集合が広すぎる誤りを見つけるため）。 */
const CASES = [
  ...[10, 12, 15, 16].map(value => ({ keyword: "CPI", value })),
  ...[4, 5, 6, 7, 8, 9, 12, 15].map(value => ({ keyword: "LPI", value }))
];

const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
const accepted = { CPI: [], LPI: [] };

/**
 * IFS へ書く。**接続を都度閉じる。**
 *
 * 開いたままだとコマンド・サーバー側の `CPYFRMSTMF` が `CPFA09E『Object in use』`で
 * 落ちる（別ジョブから読むため。実際に踏んだ）。
 */
const writeSource = async (path, lines) => {
  const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
  try {
    await ifs.writeFile(path, new TextEncoder().encode(lines.join("\n") + "\n"), {
      create: true, truncate: true
    });
  } finally { ifs.close(); }
};

try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QDDSSRC) RCDLEN(112) TEXT('DDS source')`);

  for (const { keyword, value } of CASES) {
    const source = [
      put(put(put(A(), 17, "R"), 19, "DENSR"), 45, `${keyword}(${value})`).replace(/ +$/u, ""),
      put(put(A(), 42, " 10"), 45, "'X'").replace(/ +$/u, "")
    ];
    await writeSource(`${IFS}/${MEMBER}.prtf`, source);
    const copied = await cmd.run(
      `CPYFRMSTMF FROMSTMF('${IFS}/${MEMBER}.prtf') TOMBR('/QSYS.LIB/${LIB}.LIB/QDDSSRC.FILE/${MEMBER}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`
    );
    if (!copied.success) {
      console.error("転送できません:", copied.messages.map(m => `${m.id} ${m.text}`).join(" / "));
      process.exit(1);
    }
    await cmd.run(`CHGPFM FILE(${LIB}/QDDSSRC) MBR(${MEMBER}) SRCTYPE(PRTF)`);
    const built = await cmd.run(
      `CRTPRTF FILE(QTEMP/${MEMBER}) SRCFILE(${LIB}/QDDSSRC) SRCMBR(${MEMBER}) REPLACE(*YES)`
    );
    console.log(`  ${keyword}(${String(value).padStart(2)}) → ${built.success ? "通る" : "通らない"}`);
    if (built.success) accepted[keyword].push(value);
  }
} finally {
  cmd.close();
}

const problems = [];
const compare = (keyword, expected) => {
  const actual = accepted[keyword];
  if (JSON.stringify(actual) !== JSON.stringify([...expected])) {
    problems.push(`${keyword}: 実機が受ける値 ${actual.join("/")} / 本 PJ ${[...expected].join("/")}`);
  }
};
compare("CPI", CPI_VALUES);
compare("LPI", LPI_VALUES);

console.log(`\n実機が受ける値: CPI ${accepted.CPI.join(" / ")} / LPI ${accepted.LPI.join(" / ")}`);
console.log(`本 PJ の集合  : CPI ${[...CPI_VALUES].join(" / ")} / LPI ${[...LPI_VALUES].join(" / ")}`);

if (problems.length > 0) {
  console.error(`\n✗ 不一致 ${problems.length} 件`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\n✓ 原典から生成した値の集合が実機と一致");
