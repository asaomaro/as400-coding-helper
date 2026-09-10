#!/usr/bin/env node
/**
 * DDS キーワードの**索引外からの取りこぼし**を検出する。
 *
 * `verify-dds-keywords.mjs` は「登録済みの索引」（`DSPF-KEYWORDS.html` 等）と
 * 補完データを突き合わせるが、**索引そのものに載っていないキーワード**は
 * 原理的に検出できない。実際に GRDLIN/GRDBOX/GRDATR/GRDCLR/GRDRCD の5件が
 * 主索引（`rzakcmstkeyent.htm`）に載っておらず、「DBCS を使用するための
 * キーワードに関する考慮事項」（`DSPKWD.html`）という**別の章**からしか
 * 辿れなかった（`20260908-dds-ruled-lines` で発見。research.md F1）。
 *
 * ## 特定のキーワード名をハードコードしない
 *
 * このスクリプトは「GRDLIN が居るか」のような個別チェックはしない。
 * 代わりに、**`docs/origin/dds/` 直下に取得済みの HTML 全て**（索引か
 * どうかを問わない）から `rzak[bcd]/....htm` 形式のリンクを機械的に拾い、
 * キーワードらしい表題（`NAME (和名)` の形）を持つものを補完データ
 * （`resources/completion/dds-keywords.json`）と突き合わせる。
 *
 * これにより、**次に見つかる索引外のキーワードも同じ検査で拾える**
 * ——ページ自体を先に取得してさえあれば、である。まだ一度も取得して
 * いないページの裏に隠れたキーワードは、この検査の原理的な限界として
 * 検出できない（そこは人間/AI の調査が引き続き要る。研究工程の役割）。
 *
 * 使い方:  node docs/origin/verify-dds-keyword-index-coverage.mjs
 * 終了コード: 0=OK / 1=取りこぼしあり
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const COMPLETION = join(ROOT, "vscode-extension/resources/completion");

const CATEGORY_KEYS = {
  dds: ["DDS-PF", "DDS-DSPF", "DDS-PRTF"]
};

const decode = text =>
  String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const strip = html => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// `generate-dds-keywords.mjs`/`verify-dds-keywords.mjs` と同じ表題の形
// （「NAME (和名)」）。`nn` は `CAnn`/`CFnn` の総称表記を許すため。
const TITLE_NAMES = /([A-Z][A-Z0-9]*(?:nn)?(?:\/[A-Z][A-Z0-9]*(?:nn)?)*)\s*[（(]/;
const KEYWORD_LINK = /<a[^>]*href="[^"]*\/(rzak[bcd])\/[a-z0-9_]+\.htm[^"]*"[^>]*>([\s\S]{0,120}?)<\/a>/g;

/**
 * カテゴリ直下（`detail/` は除く）の全 HTML から、キーワードらしいリンクの
 * 名前を集める。索引かどうかを問わない——「たまたま載っていた」も拾う。
 */
function linkedKeywordNames(dir) {
  const names = new Set();
  if (!existsSync(dir)) return names;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".html") && !file.endsWith(".htm")) continue;
    const html = readFileSync(join(dir, file), "utf8");

    for (const match of html.matchAll(KEYWORD_LINK)) {
      const label = strip(match[2]);
      const found = TITLE_NAMES.exec(label);
      if (!found) continue;
      for (const name of found[1].split("/")) {
        if (name.length >= 2) names.add(name);
      }
    }
  }

  return names;
}

const failures = [];

for (const [category, keys] of Object.entries(CATEGORY_KEYS)) {
  for (const lang of ["ja", "en"]) {
    const dir = join(HERE, `${category}${lang === "ja" ? "" : `-${lang}`}`);
    const linked = linkedKeywordNames(dir);
    if (linked.size === 0) continue; // このカテゴリ/言語は未取得（対象外）

    const dataPath = join(COMPLETION, lang === "ja" ? `${category}-keywords.json` : `${category}-keywords.${lang}.json`);
    if (!existsSync(dataPath)) {
      failures.push(`${category}/${lang}: 補完データが無い（${dataPath}）`);
      continue;
    }
    const data = JSON.parse(readFileSync(dataPath, "utf8"));

    const known = new Set();
    for (const key of keys) {
      for (const keyword of data[key] ?? []) known.add(keyword.name);
    }

    const missing = [...linked].filter(name => !known.has(name)).sort();
    if (missing.length > 0) {
      failures.push(
        `${category}/${lang}: 取得済みページにリンクがあるのに補完データに無い` +
          `（${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` ほか ${missing.length - 10} 件` : ""}）`
      );
    }
  }
}

console.log("DDS キーワード索引外の取りこぼし検査（詳細ページ実在 vs 補完データ）");

if (failures.length > 0) {
  console.error(`\n✗ NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("✓ 取りこぼし無し");
