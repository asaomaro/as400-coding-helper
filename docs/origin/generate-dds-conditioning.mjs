#!/usr/bin/env node
/**
 * **キーワードにオプション標識を付けられるか**の一覧を原典から生成する。
 *
 * DDS は条件が付く対象を「フィールド**または**キーワード」としているが、
 * **キーワードごとに可否が決まっている**。原典は各キーワードの詳細ページで
 * 決まり文句を書いている:
 *
 *   付けられない: 「オプション標識は、このキーワードでは無効です。」
 *   付けられる  : 「このキーワードについては、オプション標識を使用することができます。」
 *
 * ■ ひっかけ: 「フィールドの条件付け」の文
 *   付けられないキーワードの多くは、続けて
 *   「ただし、オプション標識を使用して、**このキーワードが指定されているフィールドの
 *   条件付け**を行うことはできます。」と書く。**これは逆のことを言っていない**
 *   ——キーワードは条件付けできないが、そのフィールドは条件付けできる、という意味。
 *   素朴に「使用できます」を拾うと答えが反転するので、この文は数えない。
 *
 *   **いまの原典では、この除外が答えを変えることは無い**（標識に言及する 227 ページ全部で
 *   確認済み）。「無効です」の文が必ず先に出るので、そちらで決着するため。
 *   順序に依存しない形にしておくために残してある。
 *
 * ■ 種別ごとに持つ
 *   同じキーワードでも種別で書き分けられている（`rzakb`=物理/論理・`rzakc`=表示装置・
 *   `rzakd`=印刷装置）。`EDTCDE` は表示装置・印刷装置とも「無効」。
 *
 * ■ 実機と突き合わせてある
 *   `verify-dds-conditioning.mjs` が、実機（IBM i 7.3）で `CRTDSPF` に通した
 *   5 件（`DSPATR`/`COLOR` は通る、`EDTCDE`/`EDTWRD`/`CHECK` は通らない）と
 *   一致することを見る。抽出の当たりを実機で裏打ちしている。
 *
 * 出力: resources/completion/dds-conditioning.json
 *   {
 *     "keywords": { "DSPF": { "DSPATR": true, "EDTCDE": false, ... }, "PRTF": {...}, "PF-LF": {...} },
 *     "counts": { "DSPF": { "yes": n, "no": n, "unknown": n }, ... }
 *   }
 *
 * 使い方:  node docs/origin/generate-dds-conditioning.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const DETAIL = join(HERE, "dds/detail");
const OUT = join(ROOT, "vscode-extension/resources/completion/dds-conditioning.json");

/** 詳細ページの接頭辞 → DDS の種別（原典のマニュアル番号）。 */
const KIND_BY_PREFIX = { rzakb: "PF-LF", rzakc: "DSPF", rzakd: "PRTF" };

/** 付けられない、と言っている文。 */
const CANNOT = /オプション標識は[^。]{0,30}無効|オプション標識[^。]{0,15}無効です/u;
/** 付けられる、と言っている文。 */
const CAN = /オプション標識[^。]{0,25}使用(?:することが)?でき/u;
/**
 * **キーワードではなくフィールドの条件付け**の話をしている文。
 * 「無効です」の直後に来るので、拾うと答えが反転する。
 */
const FIELD_ONLY = /フィールドの条件付け/u;

const strip = html =>
  String(html)
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();

/** 見出しからキーワード名を取る（`… の DSPATR (表示属性) キーワード`）。 */
function keywordOf(html) {
  const title = /topictitle1">([\s\S]*?)<\/h1>/u.exec(html);
  if (!title) return undefined;
  const text = strip(title[1]);
  // 「XXX (和名)」の形。`CAnn` のような総称もそのまま採る。
  const match = /(?:^|\s)([A-Z][A-Z0-9]{1,9}(?:nn)?)\s*\(/u.exec(text);
  return match ? match[1] : undefined;
}

/** 本文からオプション標識の可否を読む。判定できなければ undefined。 */
function conditioningOf(text) {
  let verdict;
  for (const sentence of text.match(/[^。]{0,150}オプション標識[^。]{0,170}。/gu) ?? []) {
    // キーワードではなくフィールドの話。数えない。
    if (FIELD_ONLY.test(sentence)) continue;
    // **「無効」が最優先。** 同じページに両方あれば「無効」を採る
    // （「無効です。ただし…使用できます」の形があるため）。
    if (CANNOT.test(sentence)) return false;
    if (CAN.test(sentence) && verdict === undefined) verdict = true;
  }
  return verdict;
}

const keywords = { "PF-LF": {}, DSPF: {}, PRTF: {} };
const counts = {
  "PF-LF": { yes: 0, no: 0, unknown: 0 },
  DSPF: { yes: 0, no: 0, unknown: 0 },
  PRTF: { yes: 0, no: 0, unknown: 0 }
};

const files = readdirSync(DETAIL).filter(name => /\.html?$/u.test(name)).sort();
let pages = 0;

for (const name of files) {
  const kind = KIND_BY_PREFIX[name.split("_")[0]];
  if (!kind) continue;
  const html = readFileSync(join(DETAIL, name), "utf8");
  const keyword = keywordOf(html);
  if (!keyword) continue;
  pages += 1;

  const verdict = conditioningOf(strip(html));
  if (verdict === undefined) {
    counts[kind].unknown += 1;
    continue;
  }
  // 同じキーワードのページが複数あるとき（同じ種別で章が分かれる形）は
  // **「無効」を優先**する。片方でも無効なら書けない。
  const current = keywords[kind][keyword];
  keywords[kind][keyword] = current === false ? false : verdict;
  counts[kind][verdict ? "yes" : "no"] += 1;
}

for (const kind of Object.keys(keywords)) {
  keywords[kind] = Object.fromEntries(
    Object.entries(keywords[kind]).sort(([a], [b]) => a.localeCompare(b))
  );
}

const payload = {
  note:
    "キーワードにオプション標識を付けられるか。docs/origin/generate-dds-conditioning.mjs が " +
    "原典の各キーワード詳細ページから生成する。手で編集しないこと。",
  source: "IBM Documentation rzakb / rzakc / rzakd のキーワード詳細ページ",
  keywords,
  counts
};

writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`条件付けの可否を書き出しました: ${OUT}`);
console.log(`  詳細ページ ${pages} 件`);
for (const kind of Object.keys(counts)) {
  const c = counts[kind];
  console.log(`  ${kind.padEnd(6)} 付けられる ${c.yes} / 付けられない ${c.no} / 判定なし ${c.unknown}`);
}
