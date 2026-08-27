#!/usr/bin/env node
/**
 * 帳票の印刷密度（CPI / LPI）に書ける値を原典から取り出す。
 *
 * 原典は各キーワードの詳細ページの「キーワードの形式」:
 *   docs/origin/dds/detail/rzakd_rzakdmstptcpi.htm   CPI (10 | 15)
 *   docs/origin/dds/detail/rzakd_rzakdmstptlpi.htm   LPI( 4 | 6 | 8 | 9 | 12)
 *
 * 既定は DDS ではなく **CRTPRTF のパラメータ**で決まる（原典に明記）。
 * その既定値は本 PJ の CL 定義（原典から生成・検証済み）から採る。
 *
 * 出力: resources/completion/dds-print-density.json
 *   { "cpi": { "values": [10, 15], "default": 10 },
 *     "lpi": { "values": [4, 6, 8, 9, 12], "default": 6 } }
 *
 * 使い方:  node docs/origin/generate-dds-print-density.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const OUT = join(ROOT, "vscode-extension/resources/completion/dds-print-density.json");
const CL = join(ROOT, "vscode-extension/resources/prompter/cl/ja/CRTPRTF.json");

const PAGES = {
  cpi: "dds/detail/rzakd_rzakdmstptcpi.htm",
  lpi: "dds/detail/rzakd_rzakdmstptlpi.htm"
};

const strip = html =>
  String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * 「キーワードの形式」の行から値を取り出す。
 *
 * 原典の書き方に**揺れがある**（`CPI (10 | 15)` と `LPI( 4 | 6 | 8 | 9 | 12)`——
 * 括弧の前後の空白の位置が違う）ので、キーワード名の後の括弧をまとめて拾い、
 * `|` で割ってから数字だけを採る。
 */
function valuesOf(name, page) {
  const whole = strip(readFileSync(join(HERE, page), "utf8"));
  // **「キーワードの形式」より後ろを見る。** ページの表題も
  // `CPI (1 インチ当たりの文字数) キーワード` の形で、先に当たってしまう（実際に踏んだ）。
  const from = whole.indexOf("キーワードの形式");
  const text = from < 0 ? whole : whole.slice(from);
  const match = new RegExp(`${name}\\s*\\(([^)]*)\\)`, "u").exec(text);
  if (!match) return undefined;

  const values = match[1]
    .split("|")
    .map(part => part.trim())
    .filter(part => /^\d+$/u.test(part))
    .map(Number);
  return values.length > 0 ? values : undefined;
}

/** `CRTPRTF` の既定値（原典から生成した CL 定義より）。 */
function defaultOf(name) {
  const definition = JSON.parse(readFileSync(CL, "utf8"));
  const found = (definition.parameters ?? []).find(parameter => parameter.name === name);
  const value = Number(found?.defaultValue);
  return Number.isFinite(value) ? value : undefined;
}

const payload = {};
for (const [key, page] of Object.entries(PAGES)) {
  const name = key.toUpperCase();
  const values = valuesOf(name, page);
  const fallback = defaultOf(name);

  if (!values) {
    console.error(`✗ ${name} の値を原典から取り出せませんでした（${page}）`);
    process.exit(1);
  }
  if (fallback === undefined) {
    console.error(`✗ ${name} の既定値を CRTPRTF の定義から取り出せませんでした`);
    process.exit(1);
  }
  if (!values.includes(fallback)) {
    console.error(`✗ ${name} の既定値 ${fallback} が原典の値 ${values.join("/")} に無い`);
    process.exit(1);
  }

  payload[key] = { values, default: fallback, source: page };
}

writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`CPI: ${payload.cpi.values.join(" / ")}（既定 ${payload.cpi.default}）`);
console.log(`LPI: ${payload.lpi.values.join(" / ")}（既定 ${payload.lpi.default}）`);
console.log("出力: resources/completion/dds-print-density.json");
