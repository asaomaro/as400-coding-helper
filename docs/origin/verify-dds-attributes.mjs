#!/usr/bin/env node
/**
 * 5250 の表示属性の対応表が原典と整合しているかを検査する。
 *
 * 生成は docs/origin/generate-dds-attributes.mjs（DSPATR の 16 進表から）。
 * ここでは 2 つを見る:
 *
 *  1. **生成物が原典の 16 進表と一致するか**（取りこぼし・ずれ）
 *  2. **原典の 2 つの表が食い違っていないか** — `COLOR` のページには
 *     「`CS`/`HI`/`BL` の組み合わせ → 色」の表が別にある。同じことを 2 か所が書いており、
 *     **どちらかが変わったら気づけるようにする**。
 *
 * 使い方:  node docs/origin/verify-dds-attributes.mjs
 * 終了コード: 0=OK / 1=不一致
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const DATA = join(ROOT, "vscode-extension/resources/completion/dds-attributes.json");
const DSPATR = join(HERE, "dds/detail/rzakc_rzakcmstdfdspat.htm");
const COLOR = join(HERE, "dds/detail/rzakc_rzakcmstdfcolor.htm");

const failures = [];
const strip = html =>
  String(html).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const cleanWord = word => word.trim().replace(/\d+$/u, "").trim();

if (!existsSync(DATA)) {
  console.error(`✗ 生成物がありません: ${DATA}`);
  process.exit(1);
}
const data = JSON.parse(readFileSync(DATA, "utf8"));

/** 表を `<tr>`/`<td>` で切り出す。 */
function rowsOf(path) {
  const html = readFileSync(path, "utf8");
  return (html.match(/<table[\s\S]*?<\/table>/gi) ?? []).map(table =>
    (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map(row =>
      (row.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map(strip)
    )
  );
}

// ---- 1. 16 進表との一致 --------------------------------------------------
const hexRows =
  rowsOf(DSPATR)
    .map(rows => rows.filter(cells => /^[0-9A-F]{2}$/u.test(cells[0] ?? "")))
    .find(rows => rows.length === 32 && rows[0][0] === "20") ?? [];

if (hexRows.length !== 32) {
  failures.push(`原典の 16 進表を取り出せない（${hexRows.length} 行）`);
} else if (data.attributes.length !== 32) {
  failures.push(`生成物が 32 件でない（${data.attributes.length} 件）`);
} else {
  for (const [index, cells] of hexRows.entries()) {
    const entry = data.attributes[index];
    if (entry.hex !== cells[0]) {
      failures.push(`${index} 番目: 16 進値が ${entry.hex} / 原典 ${cells[0]}`);
      continue;
    }
    const words = cleanWord(cells[2]) === "非表示" ? [] : cells[2].split(/[、,]/u).map(cleanWord);
    const expected = {
      nonDisplay: cleanWord(cells[2]) === "非表示",
      reverse: words.includes("反転表示"),
      underline: words.includes("下線"),
      blink: words.includes("明滅"),
      columnSeparator: words.includes("桁区切り線"),
      highlight: words.includes("高輝度")
    };
    for (const [key, value] of Object.entries(expected)) {
      if (entry[key] !== value) {
        failures.push(`${cells[0]}: ${key} が ${entry[key]} / 原典 ${value}（${cells[2]}）`);
      }
    }
  }
}

// ---- 2. COLOR ページの表と突き合わせる -----------------------------------
/** 「表 1. カラー表示装置での DSPATR キーワード」: CS / HI / BL → 色。 */
const colorRows =
  rowsOf(COLOR).find(rows => rows.some(cells => cells.some(cell => cell.startsWith("DSPATR(CS)")))) ?? [];

const COLOR_NAMES = {
  "緑": "green", "白": "white", "赤": "red",
  "空": "turquoise", "黄": "yellow", "ピンク": "pink", "青": "blue"
};

let checked = 0;
for (const cells of colorRows) {
  if (cells.length !== 4) continue;
  if (cells[3].startsWith("カラー")) continue; // 見出し
  const label = cleanWord(cells[3].split(/[、,（(]/u)[0]);
  const color = COLOR_NAMES[label];
  if (color === undefined) continue;

  const byte =
    data.bits.base |
    (cells[0] === "X" ? data.bits.CS : 0) |
    (cells[1] === "X" ? data.bits.HI : 0) |
    (cells[2] === "X" ? data.bits.BL : 0);
  const entry = data.attributes.find(candidate => candidate.byte === byte);
  checked += 1;

  if (!entry) {
    failures.push(`COLOR ページ: 0x${byte.toString(16)} が 16 進表に無い`);
  } else if (entry.color !== color) {
    failures.push(
      `**原典の 2 つの表が食い違う**: CS=${cells[0] || "-"} HI=${cells[1] || "-"} BL=${cells[2] || "-"} ` +
      `→ COLOR ページ ${label}(${color}) / 16 進表 ${entry.color}`
    );
  }
}
if (checked !== 8) {
  failures.push(`COLOR ページの表を 8 行読めなかった（${checked} 行）`);
}

// ---- 3. 色ごとのビット ---------------------------------------------------
for (const [color, bits] of Object.entries(data.colorBits)) {
  const entry = data.attributes.find(candidate => candidate.byte === (data.bits.base | bits));
  if (!entry || entry.color !== color) {
    failures.push(`colorBits の ${color}=0x${bits.toString(16)} が 16 進表と合わない`);
  }
}

console.log("DDS 表示属性（5250 の配色）の検査");
console.log(`  16 進表 ${data.attributes.length} 件 / COLOR ページの組み合わせ ${checked} 件`);
console.log(`  色ごとのビット: ${JSON.stringify(data.colorBits)}`);

if (failures.length > 0) {
  console.error(`\n✗ DDS 表示属性 NG（${failures.length}件）`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("\n✓ DDS 表示属性 OK（原典の 2 つの表が一致）");
