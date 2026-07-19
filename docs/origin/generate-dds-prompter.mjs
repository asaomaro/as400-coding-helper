#!/usr/bin/env node
/**
 * DDS の定位置項目（1-80 桁）を F4 プロンプターの定義に落とす。
 *
 * DDS は同じ A 仕様書でも用途で桁の意味が変わるため、種別ごとに定義を作る。
 *   resources/prompter/dds/{lang}/DDS-PF.json    物理/論理
 *   resources/prompter/dds/{lang}/DDS-DSPF.json  表示装置
 *   resources/prompter/dds/{lang}/DDS-PRTF.json  印刷装置
 *
 * 桁と欄名は navigation の桁定義を使う。これも原典から
 * generate-dds-columns.mjs が作ったもので、原典の書き方の揺れ（区切りが
 * 「から」「-」「−」、表示装置は条件付けを注記桁込みで書く等）の吸収は
 * そちらに集約されている。ここで作り直すと同じ罠を二度踏む。
 *
 * 各欄の説明と「有効な値」は欄ごとの詳細ページから取る。値は定義リストの
 * <dt> に「B」「I」…と1文字で並ぶ（見出し行の「項目」は除く）。
 * 値は英数字1文字。DDS のデータ・タイプには「5」(2進文字) があるので
 * 数字も落とさない。
 *
 * 使い方:  node docs/origin/generate-dds-prompter.mjs [--lang=en]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

const langArg = process.argv.find(a => a.startsWith("--lang="));
const LANG = langArg ? langArg.slice("--lang=".length) : "ja";
const ORIGIN = join(HERE, `dds${LANG === "ja" ? "" : `-${LANG}`}`);
const NAV = join(ROOT, "vscode-extension/resources/navigation");
const OUT = join(ROOT, `vscode-extension/resources/prompter/dds/${LANG}`);

const TYPES = [
  { key: "DDS-PF", overview: "PF-LF-POSITIONAL.html", prefix: "FIELD-PF-", title: "物理/論理ファイル" },
  { key: "DDS-DSPF", overview: "DSPF-POSITIONAL.html", prefix: "FIELD-DSPF-", title: "表示装置ファイル" },
  { key: "DDS-PRTF", overview: "PRTF-POSITIONAL.html", prefix: "FIELD-PRTF-", title: "印刷装置ファイル" }
];

const decode = text =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const plain = html => decode(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** 概要ページの並び順で、欄 → 詳細ページのファイル名を取る。 */
function detailPages(overviewFile, prefix) {
  const html = readFileSync(join(ORIGIN, overviewFile), "utf8");
  const pages = [];

  for (const match of html.matchAll(
    /href="[^"]*rzak[bcd]\/([a-z0-9_]+)\.htm[^"]*"[^>]*>([\s\S]{0,90}?)<\/a>/g
  )) {
    const name = match[1];
    const label = plain(match[2]);
    // 欄の説明ページだけを採る。表題に桁が入っているのが目印。
    if (!/桁目|position/i.test(label)) continue;
    if (pages.some(p => p.name === name)) continue;

    // 桁で突き合わせる。並び順に頼ると、欄の数と詳細ページの数が合わないときに
    // 1つずつずれて別の欄の説明が付く（表示装置は 14 欄に対し詳細ページが 12 件）。
    //
    // 桁の書き方が日英で逆になる:
    //   ja 「表示装置ファイルの条件付け (7 - 16 桁目)」  数字が先
    //   en 「Condition for display files (positions 7 through 16)」 数字が後
    // 括弧の中の数字を拾って最小・最大を範囲とすれば、どちらの語順でも取れる。
    const inside = /[（(]([^)）]*)[）)]\s*$/u.exec(label)?.[1] ?? label;
    const numbers = [...inside.matchAll(/\d+/g)].map(m => Number(m[0]));
    if (numbers.length === 0) continue;

    pages.push({
      name,
      label,
      from: Math.min(...numbers),
      to: Math.max(...numbers),
      file: `${prefix}${name}.html`
    });
  }

  return pages;
}

/**
 * 詳細ページから説明と有効な値を取る。
 * 値は定義リストの <dt> に1文字で並ぶ。見出し行（「項目」/「Entry」）は除く。
 */
function parseDetail(file) {
  const path = join(ORIGIN, file);
  if (!existsSync(path)) {
    return { help: undefined, options: [] };
  }

  const html = readFileSync(path, "utf8");

  // 説明は本文の冒頭。表題と Last Updated より後ろを採る。
  const body = plain(html).split(/Last Updated\s*[:：]\s*\S+\s*/)[1] ?? plain(html);
  const help = body.split(/親トピック|Parent topic/)[0].trim() || undefined;

  const options = [];
  const addOption = (term, meaning) => {
    // 原典は「ブランク」も有効な項目として挙げる（多くの欄で既定値になる）。
    // 空欄を選べないと、値を入れたあとに元へ戻せない。
    if (/^(ブランク|Blank)(\s*[（(].*[）)])?$/u.test(term)) {
      if (!options.some(o => o.value === "")) {
        options.unshift({ label: `（ブランク）${meaning.slice(0, 36)}`, value: "" });
      }
      return;
    }

    // 「B」「B (入出力共用)」の形。英数字1文字だけを値として採る。
    // 数字も落とさない（データ・タイプの「5」= 2 進文字が該当する）。
    const value = /^([A-Z0-9])(?:\s*[（(].*[）)])?$/u.exec(term);
    if (!value || options.some(o => o.value === value[1])) return;
    options.push({ label: `${value[1]}（${meaning.slice(0, 40)}）`, value: value[1] });
  };

  // 値の並べ方は 2 通りある。ページによって使い分けられているので両方読む。
  //   定義リスト  <dt>B</dt><dd>入力と出力の両方が可能</dd>   （物理/論理・表示装置）
  //   表          <tr><td>S</td><td>ゾーン 10 進数</td></tr>  （印刷装置）
  // 片方だけだと印刷装置の選択欄が丸ごと落ちる。
  for (const match of html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)) {
    addOption(plain(match[1]), plain(match[2]));
  }

  for (const table of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    for (const row of table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => plain(c[1]));
      if (cells.length >= 2) addOption(cells[0], cells[1]);
    }
  }

  // 右寄せの指定。DDS の長さ欄は「右寄せで指定しなければならない」と原典にある。
  // 左詰めで書き戻すと桁がずれた別物になるため、書き戻し側に伝える必要がある。
  // 語は日英で違う（ja「右寄せ」/ en「right-aligned」）。
  const rightAligned = /右寄せ|右詰|right[- ]?(aligned|adjusted|justified)/iu.test(body);

  return { help, options, rightAligned };
}

const columns = JSON.parse(readFileSync(join(NAV, "dds-keyword-columns.json"), "utf8"));
const labels = JSON.parse(readFileSync(join(NAV, "dds-field-labels.json"), "utf8"));

/** 桁定義は「1 始まりの開始桁」の配列。末尾の欄は 80 桁目まで。 */
const SOURCE_WIDTH = 80;

mkdirSync(OUT, { recursive: true });

for (const type of TYPES) {
  const starts = columns[type.key];
  const names = labels[type.key];
  const pages = detailPages(type.overview, type.prefix);

  const parameters = starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : SOURCE_WIDTH + 1;
    const length = end - start;
    const label = names[index] ?? "";

    // その桁を含むページを採る。複数あれば範囲の狭い方（より具体的な説明）。
    // 原典は先頭 3 欄を「1-7 桁目」とまとめて説明することがあり、その場合は
    // 3 つの欄に同じ説明が付く（原典がそう書いているので合わせる）。
    const page = pages
      .filter(p => p.from <= start && start <= p.to)
      .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
    const detail = page ? parseDetail(page.file) : { help: undefined, options: [] };

    // 45-80 桁は定位置項目ではないため、桁ごとの説明ページが無い。
    const keywordArea = start >= 45;

    const base = {
      // 入力欄の名前は表示言語に依らない内部キー。桁で決める。
      name: `C${start}`,
      description: `${label}（${length > 1 ? `${start}-${end - 1}` : start} 桁目）`,
      help:
        detail.help ??
        (keywordArea
          ? "キーワードを書く欄。キーワードの一覧と構文は補完（Ctrl+Space）で出る。"
          : undefined),
      required: false,
      sourceStart: start,
      sourceLength: length,
      attributes: {
        characterSet: "upper",
        maxLength: length,
        // 右寄せの欄は数値欄として扱う（書き戻しが padStart になる）。
        ...(detail.rightAligned ? { numericOnly: true } : {})
      }
    };

    return detail.options.length >= 2
      ? { ...base, inputType: "dropdown", options: detail.options }
      : { ...base, inputType: "text" };
  });

  const definition = {
    keyword: type.key,
    description: `${type.title}の定位置項目（A 仕様書）`,
    help:
      `${type.title}の 1-44 桁は定位置項目、45-80 桁はキーワード項目。` +
      "同じ A 仕様書でも用途で桁の意味が変わるため、種別ごとに定義を分けている。",
    source: `IBM Documentation ${type.overview}`,
    parameters
  };

  const path = join(OUT, `${type.key}.json`);
  writeFileSync(path, `${JSON.stringify(definition, null, 2)}\n`, "utf8");
  const withOptions = parameters.filter(p => p.inputType === "dropdown").length;
  console.log(
    `${type.key}: ${parameters.length} 欄（選択欄 ${withOptions} / 詳細ページ ${pages.length}）`
  );
}

console.log(`\n出力: resources/prompter/dds/${LANG}/`);
