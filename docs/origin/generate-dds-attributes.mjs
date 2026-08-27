#!/usr/bin/env node
/**
 * 5250 の**表示属性バイト**の対応表を原典から生成する。
 *
 * 原典は DSPATR キーワードの詳細ページにある「有効な P フィールド値 (無保護)」の表。
 * `DSPATR(&P フィールド)` に書ける値の一覧という体裁だが、中身は
 * **5250 の表示属性バイトそのもの**で、16 進値ごとに「完全な色」（色 ＋ 属性）が並ぶ。
 *   docs/origin/dds/detail/rzakc_rzakcmstdfdspat.htm
 *
 * この表 1 つで、
 *   - `COLOR` を書かないときの色（`CS`/`HI`/`BL` の組み合わせ）
 *   - 反転表示・下線・明滅・桁区切り線・非表示
 * のすべてが決まる。**表を手で書かない**（AGENTS.md）。
 *
 * 出力: resources/completion/dds-attributes.json
 *   {
 *     "bits": { "RI": 1, "HI": 2, "UL": 4, "BL": 8, "CS": 16, "base": 32 },
 *     "colorBits": { "GRN": 0, "WHT": 2, ... },
 *     "attributes": [ { "byte": 32, "color": "green", "reverse": false, ... }, ... ]
 *   }
 *
 * 使い方:  node docs/origin/generate-dds-attributes.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const ORIGIN = join(HERE, "dds/detail/rzakc_rzakcmstdfdspat.htm");
const COLOR_PAGE = join(HERE, "dds/detail/rzakc_rzakcmstdfcolor.htm");
const OUT = join(ROOT, "vscode-extension/resources/completion/dds-attributes.json");

/** 原典の色名（日本語）→ 識別子。**日本語は表示にしか使わない。** */
const COLORS = {
  "緑": "green",
  "白": "white",
  "赤": "red",
  "空": "turquoise",
  "黄": "yellow",
  "ピンク": "pink",
  "青": "blue"
};

/** 「完全な色」欄に現れる属性の語。 */
const ATTRIBUTES = {
  "反転表示": "reverse",
  "下線": "underline",
  "明滅": "blink",
  "桁区切り線": "columnSeparator",
  "高輝度": "highlight"
};

const strip = html =>
  String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * 脚注番号（`空1` の `1`）を落とす。**語ごとに**落とす。
 *
 * セル全体に掛けると 16 進値（`20`）まで消える（実際に踏んだ）。
 */
const cleanWord = word => word.trim().replace(/\d+$/u, "").trim();

const html = readFileSync(ORIGIN, "utf8");
const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];

/** 16 進値の表（無保護。`20`-`3F`）を探す。 */
function hexTable() {
  for (const table of tables) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    const parsed = rows
      .map(row => (row.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map(strip))
      .filter(cells => cells.length >= 3);
    const body = parsed.filter(cells => /^[0-9A-F]{2}$/u.test(cells[0]));
    if (body.length === 32 && body[0][0] === "20") return body;
  }
  return undefined;
}

const rows = hexTable();
if (!rows) {
  console.error("✗ 原典から 16 進の対応表を取り出せませんでした");
  process.exit(1);
}

const attributes = rows.map(([hex, , full]) => {
  const byte = parseInt(hex, 16);
  const nonDisplay = cleanWord(full) === "非表示";
  const words = full.split(/[、,]/u).map(cleanWord).filter(Boolean);

  const color = nonDisplay ? undefined : COLORS[words[0]];
  if (!nonDisplay && color === undefined) {
    console.error(`✗ 知らない色: ${JSON.stringify(full)}`);
    process.exit(1);
  }

  const flags = { reverse: false, underline: false, blink: false, columnSeparator: false, highlight: false };
  for (const word of nonDisplay ? [] : words.slice(1)) {
    const key = ATTRIBUTES[word];
    if (key === undefined) {
      console.error(`✗ 知らない属性: ${JSON.stringify(word)}（${full}）`);
      process.exit(1);
    }
    flags[key] = true;
  }

  return { byte, hex, color: color ?? null, nonDisplay, ...flags, origin: full };
});

/**
 * ビットの割り当て。**表から確かめる**（手で決めない）。
 * `0x21`=反転表示 / `0x22`=高輝度 / `0x24`=下線 / `0x28`=明滅 / `0x30`=桁区切り線。
 */
const bits = { RI: 0x01, HI: 0x02, UL: 0x04, BL: 0x08, CS: 0x10, base: 0x20 };

/**
 * `CS` / `HI` / `BL` の組み合わせ → 色。**COLOR ページの表 1 から採る。**
 *
 * 16 進表の「完全な色」欄でも色は読めるが、**明滅の有無はこちらにしか書かれていない**
 * （`赤、明滅なし` / `赤、明滅あり`）。色そのものは両方の表で一致する
 * （`verify-dds-attributes.mjs` が突き合わせる）。
 */
function colorTable() {
  const html = readFileSync(COLOR_PAGE, "utf8");
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows = (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map(row =>
      (row.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map(strip)
    );
    if (!rows.some(cells => (cells[0] ?? "").startsWith("DSPATR(CS)"))) continue;

    const out = [];
    for (const cells of rows) {
      if (cells.length !== 4) continue;
      const words = cells[3].split(/[、,（(]/u).map(cleanWord).filter(Boolean);
      const color = COLORS[words[0]];
      if (color === undefined) continue; // 見出し
      out.push({
        cs: cells[0] === "X",
        hi: cells[1] === "X",
        bl: cells[2] === "X",
        color,
        // 「赤、明滅あり」だけが明滅する（原典: 明滅させることができる色は、赤だけです）。
        blink: words.includes("明滅あり")
      });
    }
    return out;
  }
  return [];
}

const colors = colorTable();
if (colors.length !== 8) {
  console.error(`✗ COLOR ページの色の表を 8 行読めませんでした（${colors.length} 行）`);
  process.exit(1);
}

/** `COLOR(x)` が立てるビット（`CS`/`HI`/`BL`）。色の表から引く。 */
const colorBits = {};
for (const entry of colors) {
  // 同じ色が 2 行に出ることは無い（赤は明滅の有無で 2 行ある）。最初の行を採る。
  if (colorBits[entry.color] === undefined) {
    colorBits[entry.color] =
      (entry.cs ? bits.CS : 0) | (entry.hi ? bits.HI : 0) | (entry.bl ? bits.BL : 0);
  }
}

const payload = {
  source: {
    hex: "docs/origin/dds/detail/rzakc_rzakcmstdfdspat.htm（有効な P フィールド値・無保護）",
    colors: "docs/origin/dds/detail/rzakc_rzakcmstdfcolor.htm（表 1. カラー表示装置での DSPATR キーワード）"
  },
  bits,
  colorBits,
  colors,
  attributes: attributes.map(({ origin, ...rest }) => rest)
};

writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`表示属性 ${attributes.length} 件`);
console.log(`色ごとのビット: ${JSON.stringify(colorBits)}`);
console.log(`出力: resources/completion/dds-attributes.json`);
