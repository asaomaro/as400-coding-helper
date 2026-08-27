#!/usr/bin/env node
/**
 * package.json の contributes が、対象拡張子の定義とずれていないか検査する。
 *
 * 拡張子を足しても、それを消費する側（キーバインド）に足し忘れると機能は動かない。
 * 実際、DDS と .cmd のプロンプター定義を用意したのに F4 のキーバインドが
 * rpg-fixed / cl と .rpgle / .clp にしか効かず、.cmd も DDS も .rpg も
 * .sqlrpgle も .clle も F4 が発火しない状態だった。
 *
 * 真実源は src/utils/fileScope.ts の TARGET_EXTENSIONS。
 *
 * 使い方:  node docs/origin/verify-contributes.mjs
 * 終了コード: 0=OK / 1=不一致
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const EXT = join(ROOT, "vscode-extension");

const source = readFileSync(join(EXT, "src/utils/fileScope.ts"), "utf8");

/** `NAME = [ "a", "b" ]` から拡張子の並びを取り出す。無ければ undefined。 */
function readExtensionArray(name) {
  const block = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "u").exec(source);
  if (!block) return undefined;
  return [...block[1].matchAll(/"([a-z0-9]+)"/gu)].map(m => m[1]);
}

// TARGET_EXTENSIONS は用途別の集合（RPG/CL/DDS/CMD）の合成で、それ自体は
// 文字列リテラルを持たない。合成元をそれぞれ読んで、宣言順に連結する。
const PURPOSE_ARRAYS = [
  "RPG_EXTENSIONS",
  "CL_EXTENSIONS",
  "DDS_EXTENSIONS",
  "CMD_EXTENSIONS"
];

const extensions = [];
for (const name of PURPOSE_ARRAYS) {
  const values = readExtensionArray(name);
  if (!values || values.length === 0) {
    console.error(`✗ fileScope.ts の ${name} が読めない`);
    process.exit(1);
  }
  extensions.push(...values);
}

// TARGET_EXTENSIONS に**直接**書かれた拡張子も拾う。合成に加えて
// リテラルを並べる書き方に戻ったとき、その分が検査から静かに落ちないように。
const literalBlock = /TARGET_EXTENSIONS\s*=\s*\[([\s\S]*?)\]/u.exec(source);
for (const match of literalBlock?.[1].matchAll(/"([a-z0-9]+)"/gu) ?? []) {
  if (!extensions.includes(match[1])) {
    extensions.push(match[1]);
  }
}

// 合成元の取りこぼしを検出する。TARGET_EXTENSIONS に新しい集合が足されたのに
// PURPOSE_ARRAYS へ足し忘れると、検査対象が静かに減ってしまう。
const composition = /TARGET_EXTENSIONS\s*=\s*\[([\s\S]*?)\]/u.exec(source);
if (!composition) {
  console.error("✗ fileScope.ts の TARGET_EXTENSIONS が読めない");
  process.exit(1);
}
const spread = [...composition[1].matchAll(/\.\.\.([A-Z_]+)/gu)].map(m => m[1]);
const unknown = spread.filter(name => !PURPOSE_ARRAYS.includes(name));
if (unknown.length > 0) {
  console.error(`✗ TARGET_EXTENSIONS に未知の合成元: ${unknown.join(" ")}`);
  console.error("  このスクリプトの PURPOSE_ARRAYS にも足すこと");
  process.exit(1);
}
if (spread.length !== PURPOSE_ARRAYS.length) {
  console.error(
    `✗ TARGET_EXTENSIONS の合成元が ${spread.length} 件、検査側は ${PURPOSE_ARRAYS.length} 件`
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(EXT, "package.json"), "utf8"));
const failures = [];

/** F4 は対象拡張子すべてで発火しなければならない。 */
const prompter = (manifest.contributes?.keybindings ?? []).find(
  binding => binding.command === "rpgClSupport.showPrompter"
);

if (!prompter) {
  failures.push("F4（showPrompter）のキーバインドが無い");
} else {
  const missing = extensions.filter(
    ext => !prompter.when.includes(`resourceExtname == .${ext}`)
  );
  if (missing.length > 0) {
    failures.push(`F4 が効かない拡張子: ${missing.map(e => `.${e}`).join(" ")}`);
  }

  // 逆に、対象でない拡張子が紛れていないか。
  const extra = [...prompter.when.matchAll(/resourceExtname == \.([a-z0-9]+)/gu)]
    .map(m => m[1])
    .filter(ext => !extensions.includes(ext));
  if (extra.length > 0) {
    failures.push(`対象外なのに F4 が効く拡張子: ${extra.map(e => `.${e}`).join(" ")}`);
  }
}

/**
 * プレビューの右クリック導線は、DDS 種別の判定と一致していなければならない。
 *
 * 真実源は src/core/sourceKind.ts の resolveDdsType。ここがずれると
 * 「拡張子は対象なのにメニューに出ない」「出るのにコマンドが何もしない」
 * という、動かすまで気付けない食い違いになる。
 */
const kindSource = readFileSync(join(EXT, "src/core/sourceKind.ts"), "utf8");

/** resolveDdsType の `/\.(a|b)$/` から、その種別の拡張子を取り出す。 */
function readDdsTypeExtensions(ddsType) {
  const pattern = new RegExp(
    `\\/\\\\\\.\\(([a-z0-9|]+)\\)\\$\\/u\\.test\\(lower\\)\\)\\s*return\\s*"${ddsType}"`,
    "u"
  );
  const match = pattern.exec(kindSource);
  return match ? match[1].split("|") : undefined;
}

const PREVIEW_MENUS = [
  { command: "rpgClSupport.showDspfPreview", ddsType: "DDS-DSPF" },
  { command: "rpgClSupport.showPrtfPreview", ddsType: "DDS-PRTF" }
];

const menuItems = manifest.contributes?.menus?.["editor/context"] ?? [];

/**
 * ビジュアルエディタの右クリック導線。
 *
 * **エディタ本体が動いても、開く手段が無ければ死蔵**（AGENTS.md「追加したリソースは
 * 到達可能になって初めて完了」）。実際 `customEditors` は `priority: "option"` なので、
 * コマンドもメニューも無い間は「エディターで開く…」を知る利用者にしか届いていなかった。
 *
 * 対象は DSPF と PRTF の**和**。`ddsType` を配列で持てるように分けてある。
 */
const EDITOR_MENUS = [
  {
    command: "rpgClSupport.openDdsVisualEditor",
    ddsTypes: ["DDS-DSPF", "DDS-PRTF"],
    viewType: "rpgClSupport.ddsVisualEditor"
  }
];

for (const { command, ddsType } of PREVIEW_MENUS) {
  const expected = readDdsTypeExtensions(ddsType);
  if (!expected) {
    failures.push(`sourceKind.ts から ${ddsType} の拡張子が読めない`);
    continue;
  }

  const item = menuItems.find(entry => entry.command === command);
  if (!item) {
    failures.push(`${command} が editor/context に無い（右クリックから開けない）`);
    continue;
  }

  const declared = [...item.when.matchAll(/resourceExtname == \.([a-z0-9]+)/gu)].map(
    m => m[1]
  );
  const missing = expected.filter(ext => !declared.includes(ext));
  const extra = declared.filter(ext => !expected.includes(ext));

  if (missing.length > 0) {
    failures.push(
      `${command} が出ない拡張子: ${missing.map(e => `.${e}`).join(" ")}` +
        `（${ddsType} なのにメニューに無い）`
    );
  }
  if (extra.length > 0) {
    failures.push(
      `${command} が出るが対象外の拡張子: ${extra.map(e => `.${e}`).join(" ")}` +
        `（コマンドを実行しても何も起きない）`
    );
  }
}

/**
 * エディタの導線は **2 つの真実源**の両方と一致していなければならない。
 *
 * - `resolveDdsType`（どの拡張子がその DDS 種別か）
 * - `contributes.customEditors[].selector`（どの拡張子でエディタが開けるか）
 *
 * 片方だけ見ると「メニューに出るのに開けない」「開けるのにメニューに出ない」を
 * 通してしまう。どちらも動かすまで気付けない。
 */
for (const { command, ddsTypes, viewType } of EDITOR_MENUS) {
  const expected = [];
  let readable = true;
  for (const ddsType of ddsTypes) {
    const values = readDdsTypeExtensions(ddsType);
    if (!values) {
      failures.push(`sourceKind.ts から ${ddsType} の拡張子が読めない`);
      readable = false;
      continue;
    }
    expected.push(...values);
  }
  if (!readable) continue;

  const item = menuItems.find(entry => entry.command === command);
  if (!item) {
    failures.push(
      `${command} が editor/context に無い（右クリックから開けない）`
    );
    continue;
  }

  const declared = [...item.when.matchAll(/resourceExtname == \.([a-z0-9]+)/gu)].map(
    m => m[1]
  );
  const missingKind = expected.filter(ext => !declared.includes(ext));
  const extraKind = declared.filter(ext => !expected.includes(ext));
  if (missingKind.length > 0) {
    failures.push(
      `${command} が出ない拡張子: ${missingKind.map(e => `.${e}`).join(" ")}` +
        `（${ddsTypes.join(" / ")} なのにメニューに無い）`
    );
  }
  if (extraKind.length > 0) {
    failures.push(
      `${command} が出るが対象外の拡張子: ${extraKind.map(e => `.${e}`).join(" ")}`
    );
  }

  // コマンド自体が宣言されているか（title が無いとコマンド パレットにも出ない）。
  const declaredCommand = (manifest.contributes?.commands ?? []).find(
    entry => entry.command === command
  );
  if (!declaredCommand) {
    failures.push(`${command} が contributes.commands に無い`);
  }

  // カスタムエディタの selector と一致するか。
  const editor = (manifest.contributes?.customEditors ?? []).find(
    entry => entry.viewType === viewType
  );
  if (!editor) {
    failures.push(`customEditors に ${viewType} が無い`);
    continue;
  }
  const patterns = (editor.selector ?? [])
    .map(entry => /^\*\.([a-z0-9]+)$/u.exec(entry.filenamePattern ?? "")?.[1])
    .filter(Boolean);
  const missingSelector = patterns.filter(ext => !declared.includes(ext));
  const extraSelector = declared.filter(ext => !patterns.includes(ext));
  if (missingSelector.length > 0) {
    failures.push(
      `${viewType} は .${missingSelector.join(" .")} で開けるのに ` +
        `${command} のメニューに無い`
    );
  }
  if (extraSelector.length > 0) {
    failures.push(
      `${command} が .${extraSelector.join(" .")} に出るが ` +
        `${viewType} の selector に無い（開いても何も起きない）`
    );
  }
}

console.log(`contributes の検査（対象拡張子 ${extensions.length} 件）`);

if (failures.length > 0) {
  console.error(`\n✗ contributes NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  "✓ contributes OK（F4 が対象拡張子すべてで発火し、" +
    "プレビュー / ビジュアルエディタの右クリック導線が DDS 種別と一致する）"
);
