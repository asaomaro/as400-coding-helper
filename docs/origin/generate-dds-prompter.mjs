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
 * **原典が誤っている箇所**。実機の判定を正とする（AGENTS.md）。
 *
 * 定義を原典の誤りに合わせず、**実機で確かめてから例外として除く**。
 * 根拠は必ず添える（`verify-cl-roundtrip.mjs` の BROKEN_EXAMPLES と同じ作法）。
 */
const ORIGIN_ERRATA = [
  {
    lang: "ja",
    file: "FIELD-DSPF-pos38.html",
    // **消すのではなく直す。** 消すだけだと、日本語版から**正しい値 O が失われる**
    // （利用者は 38 桁目に O を書けなくなる）。誤植なので置き換える。
    replace: { from: "0", to: "O" },
    why:
      "日本語版は「ブランクまたは 0」（数字のゼロ）と書くが、英語版は「Blank or O」（英字のオー）。" +
      "実機（IBM i 7.3 / CRTDSPF）で確かめたところ **0 は CPD7410『示されたフィールドに文字を" +
      "使用することはできない』で弾かれ、O は通る**。対照（B=通る / Q=弾かれる）は 4/4 一致。" +
      "実サンプル docs/src/CUSTMNT.dspf も 38 桁目に O を使っている。" +
      "→ 日本語版の誤植。20260829-dds-restricted-values/verify/pos38-result.json"
  }
];

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
  const addBlank = meaning => {
    if (!options.some(o => o.value === "")) {
      options.unshift({ label: `（ブランク）${meaning.slice(0, 36)}`, value: "" });
    }
  };
  const addOption = (term, meaning) => {
    // 原典は「ブランク」も有効な項目として挙げる（多くの欄で既定値になる）。
    // 空欄を選べないと、値を入れたあとに元へ戻せない。
    if (/^(ブランク|Blank)(\s*[（(].*[）)])?$/u.test(term)) {
      addBlank(meaning);
      return;
    }

    // **「ブランクまたは 0」の形**（表示装置の 38 桁目）。1 文字の正規表現に合わず、
    // **ブランクと値の両方が落ちていた**。2 つの項目として採る。
    //
    // ここは日英で中身が違う: ja は「ブランクまたは 0」（数字のゼロ）、
    // en は「Blank or O」（英字のオー）。**どちらが正しいかは実機に判定させる**
    // ので、ここでは原典に書いてあるものをそのまま採る。
    const either = /^(?:ブランクまたは|Blank or)\s*([A-Z0-9])$/u.exec(term);
    if (either) {
      addBlank(meaning);
      if (!options.some(o => o.value === either[1])) {
        options.push({ label: `${either[1]}（${meaning.slice(0, 40)}）`, value: either[1] });
      }
      return;
    }

    // 「B」「B (入出力共用)」の形。英数字1文字だけを値として採る。
    // 数字も落とさない（データ・タイプの「5」= 2 進文字が該当する）。
    const value = /^([A-Z0-9])(?:\s*[（(].*[）)])?$/u.exec(term);
    if (!value || options.some(o => o.value === value[1])) return;
    options.push({ label: `${value[1]}（${meaning.slice(0, 40)}）`, value: value[1] });
  };

  /**
   * 「注」に列挙されたデータ・タイプを足す。
   *
   * **対象を狭く取る。** 注は他にもあり（37 桁目に 0 を指定…など）、広く拾うと
   * 関係の無い文字を値として採ってしまう。「データ・タイプ」/「data types」で
   * 始まる注だけを見て、`J (専用)` の形だけを採る。
   */
  function addNoteDataTypes(source) {
    const text = plain(source);
    const note = /(?:注|Note)\s*[:：]\s*(?:データ・タイプ|The data types)([\s\S]{0,160})/u.exec(text);
    if (!note) return;
    // 「DBCS」を含む文だけを対象にする（DBCS の説明であることの裏取り）。
    if (!/DBCS/u.test(note[1])) return;
    for (const m of note[1].matchAll(/\b([A-Z])\s*[（(]([^)）]{1,12})[）)]/gu)) {
      if (options.some(o => o.value === m[1])) continue;
      options.push({ label: `${m[1]}（${m[2]}）`, value: m[1] });
    }
  }

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

  // **値の一覧が子ページにあることがある。** 表示装置の 35 桁目（データ・タイプ／
  // キーボード・シフト）は、親ページが「表示装置ファイルの有効な項目」への
  // リンクを持つだけで、値は子ページにある。追わないと**その欄の選択肢が空になる**。
  if (options.length === 0) {
    // リンクの文字列は「**表示装置ファイルの**有効な項目」のように前置きが付く。
    // 先頭一致にすると当たらない（実際に外して気付いた）。
    const child = /href="[^"]*rzak[bcd]\/([a-z0-9_]+)\.htm[^"]*"[^>]*>(?:(?!<\/a>)[\s\S]){0,40}?(?:有効な項目|Valid entries)/u.exec(html);
    if (child) {
      const prefix = file.slice(0, file.lastIndexOf("/") + 1);
      const childPath = join(ORIGIN, `${prefix}FIELD-DSPF-valentries.html`);
      if (existsSync(childPath)) {
        const childHtml = readFileSync(childPath, "utf8");
        for (const table of childHtml.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
          for (const row of table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
            const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => plain(c[1]));
            if (cells.length >= 2) addOption(cells[0], cells[1]);
          }
        }
        addNoteDataTypes(childHtml);
      }
    }
  }

  // **一覧の直後の「注」が値を足していることがある。** DBCS のデータ・タイプ
  // （J 専用 / E 択一 / O 混用 / G 図形）は表にも定義リストにも無く、注にしかない。
  // 読まないと**実機が受ける値を弾く**（この規則が既定 OFF だった理由の 1 つ）。
  addNoteDataTypes(html);

  // 右寄せの指定。DDS の長さ欄は「右寄せで指定しなければならない」と原典にある。
  // 左詰めで書き戻すと桁がずれた別物になるため、書き戻し側に伝える必要がある。
  // 語は日英で違う（ja「右寄せ」/ en「right-aligned」）。
  const rightAligned = /右寄せ|右詰|right[- ]?(aligned|adjusted|justified)/iu.test(body);

  // 原典の誤りを除く（根拠は ORIGIN_ERRATA に書く）。
  for (const erratum of ORIGIN_ERRATA) {
    if (erratum.file !== file || erratum.lang !== LANG) continue;
    const at = options.findIndex(o => o.value === erratum.replace.from);
    if (at < 0) continue;
    if (options.some(o => o.value === erratum.replace.to)) {
      options.splice(at, 1); // 正しい値が既にあるなら誤植だけ落とす
      continue;
    }
    options[at] = {
      label: options[at].label.replace(erratum.replace.from, erratum.replace.to),
      value: erratum.replace.to
    };
  }

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
