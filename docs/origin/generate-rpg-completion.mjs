#!/usr/bin/env node
/**
 * RPG の補完データ（命令コード・組み込み関数・仕様書キーワード）を原典から生成する。
 *
 * 出所:
 *   ilerpg/OPCODES.html            命令コードの索引（名前と和名）
 *   ilerpg/BIFS.html               組み込み関数の索引
 *   ilerpg/{H,F,D,P}-SPEC-keywords.html  各仕様書のキーワード索引
 *   ilerpg/detail/<page>.htm       各命令・関数の詳細（構文の出所）
 *
 * 索引の書き方が対象で違う:
 *   命令・関数は「ACQ (獲得)」「%ABS (式の絶対値)」＝名前と和名だけ
 *   仕様書キーワードは「ACTGRP(*STGMDL | *NEW | …)」＝表題そのものが構文
 * そのため、キーワードは索引から構文を取り、命令・関数は詳細ページから取る。
 *
 * 命令の詳細ページには構文が2形式ある。固定長を扱う本PJでは従来型が要る。
 *   表「自由形式構文」        CHAIN{(ENHMR) } 検索引数 名前 { データ構造 }
 *   表「コード/演算項目1/…」  CHAIN (E N) | 検索引数 | 名前 | データ構造 | NR ER
 * 両方を持ち、補完では従来型（桁の割り当て）を主に見せる。
 *
 * 出力: resources/completion/rpg-completion{.lang}.json
 *   { opcodes: [...], bifs: [...], keywords: { "H-SPEC": [...], ... } }
 *
 * 使い方:  node docs/origin/generate-rpg-completion.mjs [--lang=en]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

const langArg = process.argv.find(a => a.startsWith("--lang="));
const LANG = langArg ? langArg.slice("--lang=".length) : "ja";
const ORIGIN = join(HERE, `ilerpg${LANG === "ja" ? "" : `-${LANG}`}`);
const DETAIL = join(ORIGIN, "detail");
const OUT = join(ROOT, "vscode-extension/resources/completion");

const decode = text =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const strip = html => decode(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** 索引から「表題 → 詳細ページ」を集める。 */
function indexEntries(file) {
  const html = readFileSync(join(ORIGIN, file), "utf8");
  return [
    ...html.matchAll(/href="[^"]*\/(rzasd\/[a-z0-9_]+\.htm)[^"]*"[^>]*>([\s\S]{0,120}?)<\/a>/g)
  ].map(match => ({ page: match[1].replace("/", "_"), title: strip(match[2]) }));
}

/**
 * 命令・関数の詳細ページから構文を取る。
 * 「自由形式構文」の表と、「コード/演算項目1/…」の表（従来型）の両方。
 */
function parseOperationSyntax(page, keyword) {
  const path = join(DETAIL, page);
  if (!existsSync(path)) return {};

  const html = readFileSync(path, "utf8");
  const result = {};

  for (const table of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
      [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => strip(cell[1]))
    );
    if (rows.length === 0) continue;

    const header = rows[0];

    // 自由形式は「自由形式構文 | CHAIN{(ENHMR)} …」の1行2列。
    // ただし MOVEL/ADD など旧命令は「(許可されていない - EVAL を使用)」という
    // 注記が入る。これは構文ではないので、命令名で始まる場合だけ採る。
    if (/自由形式構文|Free-Form Syntax/i.test(header[0] ?? "")) {
      const value = header[1] ?? "";
      if (value.toUpperCase().startsWith(keyword.toUpperCase())) {
        result.freeForm = value;
      } else if (value) {
        result.freeFormNote = value;
      }
      continue;
    }

    // 従来型は「コード | 演算項目1 | 演算項目2 | 結果フィールド | 標識」の表。
    if (/^(コード|Code)$/i.test(header[0] ?? "") && rows.length > 1) {
      result.fixedForm = {
        columns: header,
        values: rows[1]
      };
    }
  }

  // 組み込み関数は表を持たず、表題の直後に構文が地の文で置かれている。
  //   「%SUBST (サブストリングの検索) Last Updated : … %SUBST(string:start{:length}) …」
  // 表が取れなかった場合はここから拾う。
  if (!result.freeForm && !result.fixedForm) {
    const text = strip(html);
    // 冒頭は「%SUBST (サブストリングの検索) Last Updated : … %SUBST(string:start{:length})」。
    // 先頭の括弧は和名なので、"Last Updated" より後ろから構文を探す。
    // 和名を構文として拾うと %SUBST(サブストリングの検索) になる（実際に踏んだ）。
    const body = text.split(/Last Updated\s*[:：][^ ]*\s*/)[1] ?? text;
    // 本文には使用例（%date(string:*MDY0) のように小文字で書かれる）も出る。
    // 構文はその関数名と同じ表記なので、名前と厳密に一致するものだけ採る。
    const pattern = new RegExp(`(${keyword.replace("%", "%")}\\s*\\([^)]*\\))`);
    const inline = pattern.exec(body);
    if (inline) result.freeForm = inline[1].replace(/\s+/g, " ").trim();
  }

  return result;
}

/**
 * 「ACQ (獲得)」「%ABS (式の絶対値)」から名前と説明を取る。
 * ANDxx / IFxx / DOWxx / ENDyy のように、比較演算子の位置を小文字 xx で
 * 表す命令があるため、名前に小文字を許す（大文字始まりは維持）。
 */
function parseOperationTitle(title) {
  const match = /^(%?[A-Z][A-Za-z0-9-]*)\s*[（(]([^)）]*)[）)]/.exec(title);
  return match ? { name: match[1], title: match[2].trim() } : undefined;
}

/**
 * 仕様書キーワードの索引は表題そのものが構文になっている。
 *   「ACTGRP(*STGMDL | *NEW | '活動化グループ名')」→ 名前 ACTGRP ＋ 構文
 *   「ALIAS」→ パラメータ無し
 */
function parseKeywordTitle(title) {
  const match = /^([A-Z][A-Z0-9_]*)\s*(\{?\(.*)?$/.exec(title);
  if (!match) return undefined;
  return {
    name: match[1],
    syntax: title,
    hasParameters: Boolean(match[2])
  };
}

const result = { opcodes: [], bifs: [], keywords: {} };

// --- 命令コード / 組み込み関数 ---------------------------------------------
for (const [key, file] of [["opcodes", "OPCODES.html"], ["bifs", "BIFS.html"]]) {
  const seen = new Map();

  for (const { page, title } of indexEntries(file)) {
    const parsed = parseOperationTitle(title);
    if (!parsed || seen.has(parsed.name)) continue;

    const syntax = parseOperationSyntax(page, parsed.name);
    seen.set(parsed.name, { ...parsed, ...syntax });
  }

  result[key] = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  const withSyntax = result[key].filter(x => x.freeForm || x.fixedForm).length;
  console.log(`${key}: ${result[key].length} 件（構文 ${withSyntax} 件）`);
}

// --- 仕様書キーワード -------------------------------------------------------
for (const spec of ["H", "F", "D", "P"]) {
  const seen = new Map();

  for (const { title } of indexEntries(`${spec}-SPEC-keywords.html`)) {
    const parsed = parseKeywordTitle(title);
    // 索引には「制御仕様書のキーワード・フィールド」のような案内リンクも混ざる。
    // キーワードは英大文字で始まる表題だけなので、それで弾ける。
    if (!parsed || seen.has(parsed.name)) continue;
    seen.set(parsed.name, parsed);
  }

  const keywords = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  result.keywords[`${spec}-SPEC`] = keywords;
  console.log(`${spec}-SPEC キーワード: ${keywords.length} 件`);
}

mkdirSync(OUT, { recursive: true });
const suffix = LANG === "ja" ? "" : `.${LANG}`;
writeFileSync(
  join(OUT, `rpg-completion${suffix}.json`),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8"
);
console.log(`\n出力: resources/completion/rpg-completion${suffix}.json`);
