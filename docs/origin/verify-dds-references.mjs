#!/usr/bin/env node
/**
 * **参照追随の判断が網羅されている**ことを検査する。
 *
 * `src/core/dds/ddsReferences.ts` は「項目名を追う引数」を手で書いた表で持つ
 * （原典は散文なので機械的には決まらない）。手で書いた一覧は必ず漏れるので
 * （AGENTS.md「網羅したつもりの一覧は、機械で検査する」）、
 * **原典の構文に名前らしい引数を持つのに判断が書かれていないキーワード**を探す。
 *
 * 判断は 2 通りのどちらかで書かれていればよい:
 *   - 追う   → `FIELD_ARGUMENTS`（表に入っている）
 *   - 追わない → `NOT_FOLLOWED`（理由つき）
 *
 * どちらにも無ければ**落ちる**。原典に新しいキーワードが増えたときに、
 * 判断を書くまで通らない。
 *
 * ## `&` の付いた引数は数えない
 *
 * `&名前` は「このソースの中のフィールド」の印で、キーワードを問わず追う
 * （規則 A）。表に書く必要が無いので、`&` しか名前を持たないキーワードは
 * 検査の対象にしない——ただし `NOT_FOLLOWED` に書いてあっても構わない
 * （書いてある方が読み手に親切なので、余分は咎めない）。
 *
 * 使い方:  node docs/origin/verify-dds-references.mjs
 * 終了コード: 0=OK / 1=判断されていないキーワードがある
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const KEYWORDS = join(ROOT, "vscode-extension/resources/completion/dds-keywords.json");
const SOURCE = join(ROOT, "vscode-extension/src/core/dds/ddsReferences.ts");

/**
 * 原典の構文で「名前らしい引数」を表す語。
 *
 * 原典は引数を `record-format-name` / `field-name` のような語で書く。
 * **`&` が付いているものは除く**（規則 A が拾うので表に要らない）。
 */
const NAME_LIKE = /(?<![&\w-])[a-z][a-z0-9]*(?:-[a-z0-9]+)*-(?:name|field)(?:-\d+)?\b/u;

function decisionsIn(source) {
  // 表と「追わない」一覧に**書かれているキーワード名**を集める。
  // 実装を読み込まず（TS のまま）、文字列として拾う——検査が実装のビルドに依存しない。
  const names = new Set();
  for (const match of source.matchAll(/^\s*\[?\s*"([A-Z][A-Z0-9]{1,9})"\s*,/gmu)) {
    names.add(match[1]);
  }
  return names;
}

const keywords = JSON.parse(readFileSync(KEYWORDS, "utf8"));
const decided = decisionsIn(readFileSync(SOURCE, "utf8"));

const missing = [];
let checked = 0;

for (const type of ["DDS-DSPF", "DDS-PRTF"]) {
  for (const keyword of keywords[type] ?? []) {
    const syntax = (keyword.syntax ?? []).join(" ");
    if (syntax.length === 0) continue;
    // `&` の付いた引数を落としてから見る（規則 A が拾うため）。
    const withoutAmpersand = syntax.replace(/&[a-z][a-z0-9-]*/gu, " ");
    if (!NAME_LIKE.test(withoutAmpersand)) continue;
    checked += 1;
    if (decided.has(keyword.name.toUpperCase())) continue;
    missing.push(`${type.slice(4)} ${keyword.name}: ${syntax.slice(0, 80)}`);
  }
}

if (missing.length > 0) {
  console.error(
    `✗ 参照追随の判断が書かれていないキーワードが ${missing.length} 件あります` +
      "（ddsReferences.ts の FIELD_ARGUMENTS か NOT_FOLLOWED に書いてください）:"
  );
  for (const line of missing) console.error(`   ${line}`);
  process.exit(1);
}

console.log(
  `✓ 参照追随の判断 OK（名前らしい引数を持つ ${checked} 件すべてに判断がある）`
);
