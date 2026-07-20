#!/usr/bin/env node
/**
 * 編集コード表が原典と一致していることを検査する。
 *
 * この表は EDTCDE の印刷幅の根拠なので、静かにずれると帳票プレビューの
 * 桁が黙って狂う。次の 3 つを見る。
 *
 *   1. **原典が宣言する編集コードが漏れなく表にあるか**
 *      本文の「1 から 4 / A から D / J から Q / W から Z」を読み、
 *      生成物の集合と突き合わせる。原典側に新しいコードが増えたら落ちる。
 *   2. **早見表の各行の属性が生成物と一致するか**
 *      生成器と同じ読み方をもう一度して比べる（生成物が古いまま
 *      コミットされるのを防ぐ）。
 *   3. **ユーザー定義コード 5-9 が表に混ざっていないか**
 *      実機の *EDTD オブジェクトなのでソースからは決められない。
 *      混ざっていたら「オフラインで解決できるもの」を誤って広げたことになる。
 *
 * 使い方:  node docs/origin/verify-dds-editcodes.mjs
 * 終了コード: 0=OK / 1=不一致
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const ORIGIN = join(HERE, "dds/PRTF-EDITCODES.html");
const GENERATED = join(
  ROOT,
  "vscode-extension/resources/completion/dds-editcodes.json"
);

const failures = [];
const html = readFileSync(ORIGIN, "utf8");
const generated = JSON.parse(readFileSync(GENERATED, "utf8"));

/* ------------------------------------------------------------------ *
 * 1. 原典が宣言する編集コードの集合
 * ------------------------------------------------------------------ */

/**
 * 本文の「1 から 4」「A から D」のような範囲表記を読み、集合に展開する。
 * 原典が範囲を増やしたらここで気付ける。
 */
function declaredCodesFromOrigin(source) {
  const text = source
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/\s+/gu, " ");

  // 「IBM® i 編集コードは次のとおりです。」に続く範囲表記を拾う。
  const intro = text.indexOf("編集コードは次のとおり");
  if (intro < 0) return undefined;
  const window = text.slice(intro, intro + 200);

  const codes = [];
  for (const match of window.matchAll(/([0-9A-Z])\s*から\s*([0-9A-Z])/gu)) {
    const from = match[1].charCodeAt(0);
    const to = match[2].charCodeAt(0);
    if (to < from) continue;
    for (let code = from; code <= to; code += 1) {
      codes.push(String.fromCharCode(code));
    }
  }
  return codes.length > 0 ? codes : undefined;
}

const declared = declaredCodesFromOrigin(html);
if (!declared) {
  failures.push("原典から編集コードの宣言（「… から …」）が読めない");
} else {
  const generatedCodes = Object.keys(generated.editCodes ?? {});
  const missing = declared.filter(code => !generatedCodes.includes(code));
  const extra = generatedCodes.filter(code => !declared.includes(code));

  if (missing.length > 0) {
    failures.push(`原典が宣言しているのに生成物に無い: ${missing.join(" ")}`);
  }
  if (extra.length > 0) {
    failures.push(`原典の宣言に無いのに生成物にある: ${extra.join(" ")}`);
  }

  // 生成器が記録した宣言と、原典から読み直した宣言がずれていないか。
  const recorded = generated.declaredCodes ?? [];
  if (recorded.join(" ") !== declared.join(" ")) {
    failures.push(
      `生成物の declaredCodes が原典と違う\n    原典: ${declared.join(" ")}\n    生成: ${recorded.join(" ")}`
    );
  }
}

/* ------------------------------------------------------------------ *
 * 2. 早見表の属性が生成物と一致するか（生成器と同じ読み方をする）
 * ------------------------------------------------------------------ */

function cellsOf(rowHtml) {
  return [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gu)].map(match =>
    match[1]
      .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gu, "")
      .replace(/<[^>]+>/gu, "")
      .replace(/&nbsp;/gu, " ")
      .replace(/&#?\w+;/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
  );
}

const headingIndex = html.indexOf("早見表");
const tableStart = html.indexOf("<table", headingIndex - 3000);
const tableEnd = html.indexOf("</table>", tableStart);

if (headingIndex < 0 || tableStart < 0 || tableEnd < 0) {
  failures.push("原典の早見表が読めない");
} else {
  const rows = [
    ...html.slice(tableStart, tableEnd).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gu)
  ]
    .map(match => cellsOf(match[1]))
    .filter(cells => cells.length > 1);

  const header = rows.shift();
  let checked = 0;

  for (const cells of rows) {
    if (cells.length !== header.length) continue;
    const code = cells[0].toUpperCase();
    const entry = generated.editCodes?.[code];
    if (!entry) {
      failures.push(`早見表にある ${code} が生成物に無い`);
      continue;
    }

    const expected = {
      commas: cells[1] === "あり",
      decimalPoint: cells[2] === "あり",
      negativeSign: cells[3].includes("CR")
        ? "CR"
        : cells[3].includes("-") || cells[3].includes("マイナス")
          ? "minus"
          : "none",
      zeroBalance: cells[4] === "ブランク" ? "blank" : "zero",
      suppressLeadingZero: cells[7] === "あり"
    };

    for (const [key, value] of Object.entries(expected)) {
      if (entry[key] !== value) {
        failures.push(
          `${code} の ${key} が原典と違う（原典 ${JSON.stringify(value)} / 生成 ${JSON.stringify(entry[key])}）`
        );
      }
    }
    checked += 1;
  }

  if (checked === 0) {
    failures.push("早見表から 1 行も読めていない（読み取りが壊れている）");
  }
}

/* ------------------------------------------------------------------ *
 * 3. ユーザー定義コードが混ざっていないか
 * ------------------------------------------------------------------ */

const userDefined = generated.userDefinedCodes ?? [];
const leaked = userDefined.filter(code => generated.editCodes?.[code]);
if (leaked.length > 0) {
  failures.push(
    `ユーザー定義（実機の *EDTD）のコードが表に混ざっている: ${leaked.join(" ")}`
  );
}

/* ------------------------------------------------------------------ */

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}

console.log(
  `✓ 編集コード OK（原典の宣言 ${declared.length} 件と一致 / ` +
    `ユーザー定義 ${userDefined.length} 件は対象外）`
);
