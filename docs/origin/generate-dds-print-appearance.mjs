#!/usr/bin/env node
/**
 * 帳票（PRTF）の**見え方**に効くものを原典から取り出す。
 *
 * 画面（DSPF）の `DSPATR` / `COLOR` とは**別物**——実機で確かめた
 * （IBM i 7.3 / `CRTPRTF`。
 *  `.aidev/works/20260828-dds-prtf-emphasis/verify/probe-prtf-appearance.mjs`）:
 *
 *   - `DSPATR(HI)` を帳票に書くと**通らない**（画面のキーワード）
 *   - `COLOR(WHT)` は**通らない**（画面にはあるが帳票の一覧に無い）
 *   - `COLOR(BLK)` / `COLOR(BRN)` は通る（帳票にしかない名前）
 *   - `UNDERLINE` / `COLOR` を**様式に書くと通らない**（項目レベルのみ）
 *   - `HIGHLIGHT` は様式にも項目にも書ける
 *
 * 原典:
 *   dds/detail/rzakd_rzakdmstpthighl.htm   HIGHLIGHT（太字）
 *   dds/detail/rzakd_rzakdmstudln.htm      UNDERLINE（下線）
 *   dds/detail/rzakd_rzakdmstptcolor.htm   COLOR（カラー名 8 つ ＋ 装置依存の 4 形式）
 *
 * 出力: resources/completion/dds-print-appearance.json
 *
 * 使い方:  node docs/origin/generate-dds-print-appearance.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const OUT = join(ROOT, "vscode-extension/resources/completion/dds-print-appearance.json");

const COLOR_PAGE = "dds/detail/rzakd_rzakdmstptcolor.htm";
const HIGHLIGHT_PAGE = "dds/detail/rzakd_rzakdmstpthighl.htm";
const UNDERLINE_PAGE = "dds/detail/rzakd_rzakdmstudln.htm";

function plain(relative) {
  const html = readFileSync(join(HERE, relative), "utf8");
  return html
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/\s+/gu, " ");
}

/**
 * カラー名と和名を「カラー名型」の表から取る。
 *
 * 表は `パラメーター 意味 BLK 黒 BLU 青 …` の並び。**RGB の節より前**で切る
 * ——後ろには `*RGB` などの装置依存の形式が続き、そちらは名前ではない。
 */
function colorNames(text) {
  const from = text.indexOf("カラー名の場合は");
  const to = text.indexOf("RGB カラー型", from);
  if (from < 0 || to < 0) throw new Error("COLOR のカラー名型の節が見つかりません");
  const table = text.slice(from, to);

  const names = [];
  // `BLK 黒` の並び。3 文字の英大文字 ＋ 直後の和名。
  for (const match of table.matchAll(/\b([A-Z]{3})\s+(\S+?)(?=\s+[A-Z]{3}\s|\s*$)/gu)) {
    names.push({ name: match[1], label: match[2] });
  }
  if (names.length === 0) throw new Error("カラー名が 1 つも取れませんでした");
  return names;
}

/** 装置依存の形式（原典が「装置によって異なります」と書くもの）。 */
function deviceForms(text) {
  const forms = [];
  for (const form of ["*RGB", "*CMYK", "*CIELAB", "*HIGHLIGHT"]) {
    if (text.includes(`COLOR (${form}`) || text.includes(`${form} `)) forms.push(form);
  }
  return forms;
}

const colorText = plain(COLOR_PAGE);
const highlightText = plain(HIGHLIGHT_PAGE);
const underlineText = plain(UNDERLINE_PAGE);

const data = {
  /**
   * 太字。**様式に書くとその中の全項目に効く**（原典）。
   * 様式と項目の両方にあるときは「どちらか一方の標識条件が満たされていれば」効く。
   */
  highlight: {
    levels: ["record", "field"],
    inheritsFromRecord: /レコード・レベルで指定した場合には[^。]*すべてのフィールドに適用/u.test(
      highlightText
    ),
    source: HIGHLIGHT_PAGE
  },
  /** 下線。**項目レベルだけ**（実機でも様式に書くと通らない）。 */
  underline: {
    levels: ["field"],
    source: UNDERLINE_PAGE
  },
  /**
   * カラー。名前は 8 つで、**画面（DSPF）とは集合が違う**
   * （帳票にしかない `BLK` / `BRN`、帳票に無い `WHT`）。
   * 名前以外の 4 形式は原典自身が「装置によって異なります」と書くので、
   * 色を決めない（描く側は既定の黒のままにする）。
   */
  color: {
    levels: ["field"],
    default: "BLK",
    names: colorNames(colorText),
    deviceForms: deviceForms(colorText),
    source: COLOR_PAGE
  }
};

writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(
  `✓ dds-print-appearance.json を生成しました（カラー名 ${data.color.names.length} 件 / ` +
    `装置依存の形式 ${data.color.deviceForms.length} 件）`
);
