#!/usr/bin/env node
/**
 * RPG III(RPG/400) の命令コード補完データを生成する。
 *
 * 出所は2つ:
 *   rpg3-opcodes-on-ibmi.json   どの命令が存在するか（実機のコンパイラが判定）
 *   rpg-completion{.lang}.json  説明文（ILE 側の和名・英名を流用）
 *
 * RPG III と RPG IV では同じ機能でも綴りが違う（LOKUP / LOOKUP、EXCPT / EXCEPT）。
 * 説明を引くにはこの対応が要る。逆に言うと、ILE の一覧を桁数で絞っただけでは
 * RPG III の語彙にならない。
 *
 * 説明が引けない命令（RPG III にしか無いもの）は名前だけ出す。補完としては
 * 名前が出れば足りるので、説明の欠落は許容する。
 *
 * 使い方:  node docs/origin/generate-rpg3-completion.mjs [--lang=en]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const OUT = join(ROOT, "vscode-extension/resources/completion");

const langArg = process.argv.find(a => a.startsWith("--lang="));
const LANG = langArg ? langArg.slice("--lang=".length) : "ja";
const suffix = LANG === "ja" ? "" : `.${LANG}`;

/**
 * RPG III の綴り → ILE(RPG IV) の綴り。
 * RPG IV で名前が伸びたものが大半で、機能は同じ。
 */
const RENAMED = {
  BITOF: "BITOFF",
  CHEKR: "CHECKR",
  COMIT: "COMMIT",
  DEFN: "DEFINE",
  DELET: "DELETE",
  EXCPT: "EXCEPT",
  LOKUP: "LOOKUP",
  OCUR: "OCCUR",
  REDPE: "READPE",
  RETRN: "RETURN",
  SELEC: "SELECT",
  SETOF: "SETOFF",
  UNLCK: "UNLOCK",
  UPDAT: "UPDATE",
  WHxx: "WHENxx",
  // ENDxx は ILE 側では ENDyy の1項目にまとめられている。
  ENDCS: "ENDyy",
  ENDDO: "ENDyy",
  ENDIF: "ENDyy",
  ENDSL: "ENDyy"
};

const snapshot = JSON.parse(
  readFileSync(join(HERE, "rpg3-opcodes-on-ibmi.json"), "utf8")
);
const ile = JSON.parse(
  readFileSync(join(OUT, `rpg-completion${suffix}.json`), "utf8")
);

const ileByName = new Map(ile.opcodes.map(o => [o.name, o]));

let described = 0;
const opcodes = snapshot.valid.map(name => {
  const source = ileByName.get(RENAMED[name] ?? name);
  if (!source) {
    return { name };
  }
  described += 1;
  return {
    name,
    title: source.title,
    // 従来型の構文（演算項目1/2・結果フィールド・標識）は RPG III でも通じる。
    // 自由形式は RPG IV のものなので持ち込まない。
    ...(source.fixedForm ? { fixedForm: source.fixedForm } : {})
  };
});

const result = {
  note: `RPG III(RPG/400) の命令コード。存在するかは実機のコンパイラが判定（${snapshot.machine}）。説明は ILE 側から綴りの対応をたどって流用する。`,
  opcodeColumns: { from: 28, to: 32 },
  opcodes
};

mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, `rpg3-completion${suffix}.json`),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8"
);

console.log(`命令コード: ${opcodes.length} 件（説明あり ${described} 件）`);
console.log(`出力: resources/completion/rpg3-completion${suffix}.json`);
