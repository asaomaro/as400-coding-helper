#!/usr/bin/env node
/**
 * DDS の定位置項目（1-44 桁）をルーラー用の桁定義に落とす。
 *
 * DDS は同じ A 仕様書でも、用途（物理/論理・表示装置・印刷装置）で
 * 桁の意味が変わる。原典もファイル種別ごとに別ページになっている:
 *   docs/origin/dds/PF-LF-POSITIONAL.html   物理/論理
 *   docs/origin/dds/DSPF-POSITIONAL.html    表示装置
 *   docs/origin/dds/PRTF-POSITIONAL.html    印刷装置
 *
 * 本文は「ラベル (N から M 桁目)」の形で各欄を説明しているので、そこから拾う。
 * ページによって書き方が揺れる（「印刷装置ファイルの 1 から 5 桁目」と
 * 「(1 - 5 桁目)」、区切りが「から」「-」「−」など）ため、区切り記号を
 * 網羅したうえで、ファイル種別の接頭辞を落として正規化している。
 *
 * 出力は既存のルーラー定義と同じ形式:
 *   resources/navigation/dds-keyword-columns.json  種別 → 桁（1 始まり）
 *   resources/navigation/dds-field-labels.json     種別 → 欄の名前
 *
 * 使い方:  node docs/origin/generate-dds-columns.mjs [--lang=en]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

const langArg = process.argv.find(a => a.startsWith("--lang="));
const LANG = langArg ? langArg.slice("--lang=".length) : "ja";
const ORIGIN = join(HERE, `dds${LANG === "ja" ? "" : `-${LANG}`}`);
const OUT = join(ROOT, "vscode-extension/resources/navigation");

/** ルーラーで使う種別名。specClassifier の戻り値と一致させる。 */
const TYPES = [
  { key: "DDS-PF", file: "PF-LF-POSITIONAL.html" },
  { key: "DDS-DSPF", file: "DSPF-POSITIONAL.html" },
  { key: "DDS-PRTF", file: "PRTF-POSITIONAL.html" }
];

const decode = text =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const plain = html =>
  decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

// 区切りは「から」のほか各種ハイフン・波ダッシュが使われる。
const SEPARATOR = "(?:から|through|[-‐-−–—－〜~])";
const ENTRY = new RegExp(
  `([^\\s。、（()]{1,30})\\s*[（(](?:[^)）]*?の\\s*)?(\\d+)(?:\\s*${SEPARATOR}\\s*(\\d+))?\\s*(?:桁目|positions?)[）)]`,
  "g"
);
// ラベル先頭に付くファイル種別の名前を落とす。
const PREFIX =
  /^(表示装置ファイル|印刷装置ファイル|物理ファイルおよび論理ファイル|物理ファイル|論理ファイル)(用に|の)?/;

function parseColumns(file) {
  const text = plain(readFileSync(join(ORIGIN, file), "utf8"));
  const entries = new Map();

  for (const match of text.matchAll(ENTRY)) {
    const from = Number(match[2]);
    const to = Number(match[3] ?? match[2]);

    // 1-44 は「定位置項目の全体」を指す見出しなので個別の欄ではない。
    if ((from === 1 && to === 44) || to > 80) continue;

    const label = PREFIX.exec(match[1]) ? match[1].replace(PREFIX, "").trim() : match[1].trim();
    if (!label || label === "桁目" || label === "定位置項目") continue;

    const key = `${from}-${to}`;
    if (!entries.has(key)) entries.set(key, { from, to, label });
  }

  const found = [...entries.values()].sort((a, b) => a.from - b.from || a.to - b.to);

  // 原典はページごとに書き方が揺れる。
  // 7 桁目は注記標識で、条件付けはその次の桁から始まる欄。ところが表示装置と
  // 印刷装置のページは条件付けを「7 - 16 桁目」と、注記桁を含めて書いている
  // （物理/論理のページは「8 - 16 桁目」）。ルーラーは開始桁の一覧なので、
  // このままだと注記と条件付けが同じ 7 桁目で衝突し、条件付けが落ちる。
  // 物理/論理の書き方に揃えて 8 桁目始まりに直す。
  const adjusted = found.map(entry =>
    entry.from === 7 && entry.to === 16 ? { ...entry, from: 8 } : entry
  );

  // それでも開始桁が重複する記述は、狭い方（具体的な欄）を採る。
  const byStart = new Map();
  for (const entry of adjusted) {
    const current = byStart.get(entry.from);
    if (!current || entry.to - entry.from < current.to - current.from) {
      byStart.set(entry.from, entry);
    }
  }

  // ページによっては先頭の欄をまとめて「1-7 桁目」とだけ書く（表示装置）。
  // 他の種別と同じ粒度に揃えるため、順序番号・仕様書タイプ・注記を補う。
  const filled = [...byStart.values()];
  if (!byStart.has(1)) {
    filled.push(
      { from: 1, to: 5, label: "順序番号" },
      { from: 6, to: 6, label: "仕様書タイプ" },
      { from: 7, to: 7, label: "注記" }
    );
  }

  // キーワード項目(45-80)は全種別に存在する。書かれていないページがあるため補う。
  if (!filled.some(entry => entry.from === 45)) {
    filled.push({ from: 45, to: 80, label: "キーワード項目" });
  }

  // ルーラーは開始桁の一覧なので、同じ桁が2つあってはならない。
  // 補った欄が原典の記述（表示装置の「条件付け 7-16」など）と重なるため、
  // 補完後にもう一度、狭い方を採って畳む。
  const unique = new Map();
  for (const entry of filled.sort((a, b) => a.from - b.from || a.to - b.to)) {
    if (!unique.has(entry.from)) unique.set(entry.from, entry);
  }

  return [...unique.values()].sort((a, b) => a.from - b.from);
}

const columns = {};
const labels = {};

for (const { key, file } of TYPES) {
  const entries = parseColumns(file);
  if (entries.length === 0) {
    console.error(`✗ ${key}: 桁が1件も取れなかった（${file}）`);
    process.exit(1);
  }
  columns[key] = entries.map(entry => entry.from);
  labels[key] = entries.map(entry => entry.label);
  console.log(`${key}: ${entries.length} 欄  ${entries.map(e => `${e.from}-${e.to}`).join(" ")}`);
}

const suffix = LANG === "ja" ? "" : `.${LANG}`;
writeFileSync(
  join(OUT, `dds-keyword-columns${suffix}.json`),
  `${JSON.stringify(columns, null, 2)}\n`,
  "utf8"
);
writeFileSync(
  join(OUT, `dds-field-labels${suffix}.json`),
  `${JSON.stringify(labels, null, 2)}\n`,
  "utf8"
);
console.log(`\n出力: resources/navigation/dds-{keyword-columns,field-labels}${suffix}.json`);
