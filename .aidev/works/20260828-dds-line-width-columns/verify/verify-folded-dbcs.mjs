// **折り返しが書き出した実物**を実機に通す。
// テストは「どの塊も 36 桁以内」を固定するだけなので、その形が通ることは別に見る。
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const EXT = "/workspaces/as400-coding-helper/vscode-extension";
const { applyDdsEdits } = await import(join(EXT, "out/core/dds/ddsEdit.js"));
const { foldKeywordArea } = await import(join(EXT, "out/core/dds/ddsEditWriteBack.js"));
const { printWidth } = await import(join(EXT, "out/core/dbcs.js"));

const put = (l, c, v) => { const a = l.split(""); for (let i = 0; i < v.length; i += 1) a[c - 1 + i] = v[i]; return a.join(""); };
const A = () => put(" ".repeat(80), 6, "A");
const T = l => l.replace(/ +$/u, "");
const rec = n => T(put(put(A(), 17, "R"), 19, n));
const kwLine = t => T(put(A(), 45, t));
const head = (row, t) => T(put(put(put(A(), 39, String(row).padStart(3)), 42, "  2"), 45, t));

// 全角を増やしながら、折り返しの結果をそのまま流す。
const build = count => {
  const chunks = foldKeywordArea(`'${"顧".repeat(count)}'`);
  return [rec("MAIN"), head(5, chunks[0]), ...chunks.slice(1).map(kwLine)];
};

const CASES = [];
for (const count of [10, 16, 17, 20, 34]) {
  const src = build(count);
  CASES.push({
    n: `F${count}`,
    why: `全角 ${count} 文字（${src.length - 1} 行に折れた・最大 ${Math.max(
      ...src.slice(1).map(l => printWidth(l.slice(44)))
    )} 桁）`,
    src
  });
}

const hs = await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = { host: sys.host, user: sys.signon.user, password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc) };
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;

const ifs = await hs.IfsConnection.connect({ ...creds, resolvePort: true });
try { for (const c of CASES) await ifs.writeFile(`${IFS}/${c.n}.dds`, new TextEncoder().encode(c.src.join("\n") + "\n"), { create: true, truncate: true }); }
finally { ifs.close(); }
const cmd = await hs.CommandConnection.connect({ ...creds, resolvePort: true });
let bad = 0;
try {
  for (const c of CASES) {
    await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/${c.n}.dds') TOMBR('/QSYS.LIB/${LIB}.LIB/QDDSSRCJ.FILE/${c.n}.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
    await cmd.run(`CHGPFM FILE(${LIB}/QDDSSRCJ) MBR(${c.n}) SRCTYPE(DSPF)`);
    const r = await cmd.run(`CRTDSPF FILE(${LIB}/${c.n}) SRCFILE(${LIB}/QDDSSRCJ) SRCMBR(${c.n}) REPLACE(*YES)`);
    if (!r.success) bad += 1;
    console.log(`${r.success ? "通る  " : "**通らない**"} ${c.n} ${c.why}`);
    if (!r.success) console.log(c.src.join("\n"));
    if (r.success) await cmd.run(`DLTF FILE(${LIB}/${c.n})`);
    await cmd.run(`RMVM FILE(${LIB}/QDDSSRCJ) MBR(${c.n})`);
    await cmd.run(`RMVLNK OBJLNK('${IFS}/${c.n}.dds')`);
  }
} finally { cmd.close(); }
process.exit(bad === 0 ? 0 : 1);
