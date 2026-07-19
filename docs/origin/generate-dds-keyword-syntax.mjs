#!/usr/bin/env node
/**
 * DDS キーワードの構文を、各キーワードの詳細ページから抽出する。
 *
 * 索引（generate-dds-keywords.mjs が使う）にはキーワード名と概要しか無い。
 * 構文 `DSPSIZ(*DSw [*DSx])` は詳細ページ側にある。
 *   docs/origin/dds/detail/<rzakX_yyy.htm>
 *
 * 詳細ページでの構文の書かれ方は3通りある:
 *   1. <pre> に入っている（大半。194/285）
 *   2. 「このキーワードにはパラメーターはありません」と書かれている（88/285）
 *   3. 本文に「キーワードの形式は SFLCHCCTL です」の形で埋まっている（3/285）
 * <pre> は使用例（DDS の桁定規 `|...+....1` で始まる）にも使われるため、
 * それは構文ではないものとして除く。
 *
 * 出力は既存の補完データに syntax / hasParameters を足す形。
 *
 * 使い方:  node docs/origin/generate-dds-keyword-syntax.mjs [--lang=en]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

const langArg = process.argv.find(a => a.startsWith("--lang="));
const LANG = langArg ? langArg.slice("--lang=".length) : "ja";
const ORIGIN = join(HERE, `dds${LANG === "ja" ? "" : `-${LANG}`}`);
const DETAIL = join(ORIGIN, "detail");
const COMPLETION = join(ROOT, "vscode-extension/resources/completion");

const TYPES = [
  { key: "DDS-PF", file: "PF-LF-KEYWORDS.html" },
  { key: "DDS-DSPF", file: "DSPF-KEYWORDS.html" },
  { key: "DDS-PRTF", file: "PRTF-KEYWORDS.html" }
];

const decode = text =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const strip = html => decode(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** 索引から「キーワード名 → 詳細ページのファイル名」を作る。 */
function detailPaths(indexFile) {
  const html = readFileSync(join(ORIGIN, indexFile), "utf8");
  const map = new Map();

  for (const match of html.matchAll(
    /href="[^"]*\/(rzak[bcd]\/[a-z0-9_]+\.htm)[^"]*"[^>]*>([\s\S]{0,90}?)<\/a>/g
  )) {
    const label = strip(match[2]);
    const names = /([A-Z][A-Z0-9]*(?:\/[A-Z][A-Z0-9]*)*)\s*[（(]/.exec(label);
    if (!names) continue;

    for (const name of names[1].split("/")) {
      if (name.length >= 2 && !map.has(name)) {
        map.set(name, match[1].replace("/", "_"));
      }
    }
  }

  return map;
}

/**
 * 詳細ページから構文を取り出す。
 * 返り値の hasParameters が false なら「パラメーターを取らないキーワード」。
 */
function parseSyntax(file, keyword) {
  const path = join(DETAIL, file);
  if (!existsSync(path)) return undefined;

  const html = readFileSync(path, "utf8");

  // 1. <pre> の構文。DDS の使用例（桁定規で始まる）は除く。
  const blocks = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)]
    .map(m => decode(m[1].replace(/<[^>]+>/g, "")).trim())
    .filter(text => text.length > 0 && !text.startsWith("|..."));

  // <pre> には構文のほか、画面の見た目や出力例（"11:06:45" など）も入る。
  // 構文はキーワード名で始まる行なので、それで絞る。
  // 連名ページ（ALTPAGEDWN/ALTPAGEUP を1ページで説明）もあるため、
  // 当該キーワードの行だけを採る。
  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !/^(または|or)$/i.test(line))
      .filter(line => line.startsWith(keyword));

    if (lines.length > 0) {
      return { syntax: lines, hasParameters: lines.some(line => line.includes("(")) };
    }
  }

  const text = strip(html);

  // 2. パラメーターを取らないキーワード。
  if (/パラメーターは(ありません|ない)|パラメーターを持ちません|has no parameters/.test(text)) {
    return { syntax: [keyword], hasParameters: false };
  }

  // 3. 本文に「キーワードの形式は … です」の形で埋まっているもの。
  const inline =
    /(?:キーワードの形式は|形式は)、?\s*([A-Z][A-Z0-9]*[^。]{0,60}?)\s*です/.exec(text) ??
    /The format of (?:the |this )?keyword is\s+([A-Z][A-Z0-9]*[^.]{0,60}?)\./.exec(text);
  if (inline) {
    return { syntax: [inline[1].trim()], hasParameters: /[（(]/.test(inline[1]) };
  }

  return undefined;
}

/**
 * 使用レベル。索引から取れなかったものを詳細ページの本文で補う。
 * 本文は「これはフィールド・レベル・キーワードで…」の形で書かれている。
 * 語は日英で違うので両方の言い回しを見る。
 */
const LEVEL_PATTERNS = [
  { level: "file", re: /ファイル・レベル|file[- ]level/iu },
  { level: "record", re: /レコード・レベル|record[- ]level/iu },
  { level: "field", re: /フィールド・レベル|field[- ]level/iu },
  { level: "help", re: /ヘルプ・レベル|help[- ]level/iu },
  { level: "key", re: /キー・フィールド・レベル|key field[- ]level/iu },
  { level: "join", re: /結合レベル|join[- ]level/iu },
  { level: "select", re: /選択\/省略レベル|select\/omit[- ]level/iu }
];

/** 詳細ページの本文から使用レベルを読む。 */
function parseLevels(file) {
  const path = join(DETAIL, file);
  if (!existsSync(path)) return [];

  const text = strip(readFileSync(path, "utf8"));
  // 「キー・フィールド・レベル」は「フィールド・レベル」を含むため、
  // 長い方から先に消してから判定する。順番を誤ると field が過剰に付く。
  let rest = text;
  const found = [];
  for (const { level, re } of [...LEVEL_PATTERNS].sort(
    (a, b) => b.re.source.length - a.re.source.length
  )) {
    if (re.test(rest)) {
      found.push(level);
      rest = rest.replace(new RegExp(re.source, "giu"), " ");
    }
  }
  return found;
}

const suffix = LANG === "ja" ? "" : `.${LANG}`;
const dataPath = join(COMPLETION, `dds-keywords${suffix}.json`);
const data = JSON.parse(readFileSync(dataPath, "utf8"));

let filled = 0;
let missing = 0;
let levelFilled = 0;

for (const { key, file } of TYPES) {
  const paths = detailPaths(file);

  for (const keyword of data[key] ?? []) {
    const detail = paths.get(keyword.name);
    const parsed = detail ? parseSyntax(detail, keyword.name) : undefined;

    if (parsed) {
      keyword.syntax = parsed.syntax;
      keyword.hasParameters = parsed.hasParameters;
      filled += 1;
    }

    // 使用レベルは索引から取れないものがある（COLOR / EDTCDE など）。
    // 補完で出す・出さないの判定に使うので、詳細ページから補う。
    if (!keyword.level?.length && detail) {
      const levels = parseLevels(detail);
      if (levels.length > 0) {
        keyword.level = levels;
        levelFilled += 1;
      }
    } else {
      missing += 1;
    }
  }

  const withSyntax = (data[key] ?? []).filter(k => k.syntax).length;
  console.log(`${key}: ${withSyntax} / ${(data[key] ?? []).length} 件に構文`);
}

writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`\n構文を付与 ${filled} 件 / 取れず ${missing} 件`);
console.log(`使用レベルを補った ${levelFilled} 件`);
console.log(`出力: resources/completion/dds-keywords${suffix}.json`);
