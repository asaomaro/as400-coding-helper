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
  { key: "DDS-PF", overview: "PF-LF-POSITIONAL.html", prefix: "FIELD-PF-" },
  { key: "DDS-DSPF", overview: "DSPF-POSITIONAL.html", prefix: "FIELD-DSPF-" },
  { key: "DDS-PRTF", overview: "PRTF-POSITIONAL.html", prefix: "FIELD-PRTF-" }
];

/**
 * **表示に出る文字を 1 か所に集める。**
 *
 * 以前は種別名も欄の説明もブランクの接頭辞も生成器にじか書きされており、
 * `--lang=en` で作った定義に**日本語が 146 箇所**残っていた。
 *
 * 訳すのは**説明とラベルだけ**。桁・欄の名前・選択肢の値といった**事実は訳さない**
 * ——欄の名前は `dds-field-labels{,.en}.json`（原典から生成）、値は原典の詳細ページから来る。
 * RPG 側の規約（`docs/origin/rpg-spec-en-strings.json`）と同じ考え方。
 */
const STRINGS = {
  ja: {
    title: { "DDS-PF": "物理/論理ファイル", "DDS-DSPF": "表示装置ファイル", "DDS-PRTF": "印刷装置ファイル" },
    columns: range => `（${range} 桁目）`,
    blank: meaning => `（ブランク）${meaning}`,
    option: (value, meaning) => `${value}（${meaning}）`,
    fileDescription: title => `${title}の定位置項目（A 仕様書）`,
    fileHelp: title =>
      `${title}の 1-44 桁は定位置項目、45-80 桁はキーワード項目。` +
      "同じ A 仕様書でも用途で桁の意味が変わるため、種別ごとに定義を分けている。",
    keywordHelp: "キーワードを書く欄。キーワードの一覧と構文は補完（Ctrl+Space）で出る。"
  },
  en: {
    title: { "DDS-PF": "physical and logical files", "DDS-DSPF": "display files", "DDS-PRTF": "printer files" },
    columns: range => ` (position${/-/u.test(range) ? "s" : ""} ${range})`,
    blank: meaning => `(Blank) ${meaning}`,
    option: (value, meaning) => `${value} (${meaning})`,
    fileDescription: title => `Positional entries for ${title} (A specification)`,
    fileHelp: title =>
      `Positions 1-44 of ${title} are positional entries; positions 45-80 are keyword entries. ` +
      "The same A specification means different things per file type, so each type has its own definition.",
    keywordHelp: "Keyword area. The keyword list and syntax are available from completion (Ctrl+Space)."
  }
};
const T = STRINGS[LANG] ?? STRINGS.ja;

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
/**
 * **値集合を「網羅」で確かめ、実機の受理集合と完全一致した欄**。ここだけ `restricted: true`。
 *
 * 1 文字の欄は空間が 37 通り（ブランク ＋ A-Z ＋ 0-9）なので、全部試せば
 * 漏れが無いことまで決まる。列挙された値だけ試しても**漏れは分からない**。
 *
 * 判定は**リストの「メッセージ番号 ＋ 印が指す桁」**で読む。作成の成否では決まらない
 * ——有効な値でも長さや小数の前提が違えば落ちる。
 *
 * | 番号 | 意味 | 集合 |
 * |---|---|---|
 * | `CPD7419` Data type not valid.                                    | 値が無効 | 無効 |
 * | `CPD7410` Characters in indicated field not allowed.              | 値が無効 | 無効 |
 * | `CPD7408` Entry for decimal positions or field length not valid.  | 値は受理 | **受理** |
 * | `CPD7635` Length too large for floating-point precision.          | 値は受理 | **受理** |
 * | `CPD7914` File contains more than one record.（17 桁で出る）      | 値は受理 | **受理** |
 *
 * | 欄 | 実機の受理 | 状態 |
 * |---|---|---|
 * | 物理/論理 17 桁 | ブランク J K O R S | 3 文脈（物理・単純論理・結合論理）で同一。一致 → `true` |
 * | 物理/論理 35 桁 | ブランク ＋ 14 件 | 一致 → `true`（ブランクは `BLANK_FROM_PROSE`） |
 * | 物理/論理 38 桁 | ブランク B I N | **文脈ごとに違う**（下記）。和が定義と一致 → `true` |
 * | 表示装置 17 桁 | ブランク H R | 一致 → `true` |
 * | 表示装置 35 桁 | ブランク ＋ 17 件 | 一致 → `true` |
 * | 表示装置 38 桁 | ブランク B H I M O P | 前作業で確定済み → `true` |
 * | 印刷装置 35 桁 | ブランク ＋ 8 件 | 一致 → `true`（`G` `O` は注から、ブランクは本文から） |
 * | 印刷装置 38 桁 | ブランク O P | 一致 → `true`（値は箇条書きから。位置あり／なしとも同じ） |
 * | 印刷装置 17 桁 | ブランク **H** R | **不一致 → `false`**（下記） |
 *
 * **物理/論理 38 桁は文脈で値が変わる。** 原典（`FIELD-PF-lfusg.html`）が
 * 「物理ファイルの場合」「論理ファイルに有効な項目」と分けて書いており、実機も一致した:
 * 物理(`CRTPF`) = ブランク B / 単純論理(`PFILE`) = ＋I / 結合論理(`JFILE`) = ブランク I N
 * （結合論理に `B` は不可——「結合論理ファイルは読み取り専用ファイルであるため」）。
 * **1 つの定義が `.pf` と `.lf` の両方を担う**ので、対応するのは 3 文脈の**和**。
 *
 * **印刷装置 17 桁は `false` のまま。** 実機は `H` を受ける（`CPD7410@17` が出ず、
 * 35 桁と 42 桁の指摘だけが出る）が、**原典は日英とも `R` とブランクだけ**を挙げる
 * （`FIELD-PRTF-prttype.html` / `dds-en` も同じ）。原典に無い値を定義へ足す判断は、
 * `H`（ヘルプ仕様）が印刷装置で何を意味するのかが分からないまま行えない。
 * `false` なら候補つきの自由入力のままで、`H` を書きたい利用者を妨げない。
 *
 * 根拠: `.aidev/works/20260829-dds-restricted-expand/verify/`
 * （`compare.mjs` が実機の結果と定義を突き合わせ、`compare.json` に残す）
 * / 表示装置 38 桁は `.aidev/works/20260829-dds-restricted-enable/verify/`
 */
const PROVEN_COMPLETE = new Set([
  "DDS-PF:17", "DDS-PF:35", "DDS-PF:38",
  "DDS-DSPF:17", "DDS-DSPF:35", "DDS-DSPF:38",
  "DDS-PRTF:35", "DDS-PRTF:38"
]);

/**
 * **ブランクが「値の一覧」ではなく本文にしか書かれていない欄。**
 *
 * 生成器がブランクを採るのは、`<dt>` や表の項目が「ブランク」と書かれているときだけ
 * （`addBlank`）。ところが 2 つの欄では**本文だけ**にあり、落ちていた。
 *
 * 落とすと害が出る。`restricted: true` の欄は画面が `<select>` になり、
 * **一覧に無い値へは戻せない**（`webview/ui.ts` の `buildSelect`）。
 * データ・タイプのブランクは「既定（文字／基礎ファイルと同じ）」を意味する常用の値で、
 * 実機も受ける。落としたままにはできない。
 *
 * **本文の解析はしない。** 書き方が揃っておらず、**別の桁の話を拾う**。実際、
 * 印刷装置のページには「小数点以下の桁数 **(36 から 37 桁目)** がブランクであれば
 * A (文字)」とあり、ブランクなのは 35 桁目ではない。素朴な照合はここで誤る。
 *
 * **入れる条件は 2 つとも要る**——原典の本文にブランクの意味が書かれていること、
 * **かつ実機の網羅がブランクを受理したこと**。片方だけでは入れない。
 */
const BLANK_FROM_PROSE = [
  {
    type: "DDS-PF",
    column: 35,
    meaning: { ja: "基礎となる物理ファイルと同じデータ・タイプ", en: "Same data type as the physical file" },
    origin: {
      ja: "この欄がブランクであれば、定義中のフィールドのデータ・タイプは、"
        + "この論理ファイルの基礎となる物理ファイル内の対応するフィールドのデータ・タイプと同じものになります。",
      en: "If you leave this position blank, the field you are defining has the same data type "
        + "as the corresponding field in the physical files on which the logical files are based."
    },
    machine:
      "全 37 通りのうちブランクは指摘なし（CRTPF / CRTLF(PFILE) / CRTLF(JFILE) の 3 文脈とも）。"
      + "20260829-dds-restricted-expand/verify/exhaustive-XPF35.txt"
  },
  {
    type: "DDS-PRTF",
    column: 35,
    meaning: { ja: "文字（既定）", en: "Character (default)" },
    origin: {
      ja: "データ・タイプを指定せず、参照フィールドから複写もしなかった場合には、"
        + "IBM i オペレーティング・システムはデフォルトにより次の値を割り当てます。"
        + "小数点以下の桁数 (36 から 37 桁目) がブランクであれば A (文字)。",
      en: "If you do not specify a data type and do not copy one from a referenced field, "
        + "the IBM i operating system assigns the following defaults: "
        + "A (character) if the decimal positions (positions 36 through 37) are blank."
    },
    machine:
      "全 37 通りのうちブランクは指摘なし（CRTPRTF）。"
      + "20260829-dds-restricted-expand/verify/exhaustive-XPR35.txt"
  }
];

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
      options.unshift({ label: T.blank(meaning.slice(0, 36)), value: "" });
    }
  };
  const addOption = (term, rawMeaning) => {
    // **箇条書きは意味の側にコロンを置く**（`<li><samp>P</samp>: プログラム…</li>`）。
    // そのままだとラベルが `P（: プログラム…）` になる。区切りなので落とす。
    const meaning = String(rawMeaning).replace(/^\s*[:：]\s*/u, "").trim();
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
        options.push({ label: T.option(either[1], meaning.slice(0, 40)), value: either[1] });
      }
      return;
    }

    // **「X またはブランク」の形**（印刷装置の 38 桁目）。上の「ブランクまたは X」の
    // 鏡像で、原典は箇条書きの側に値を、説明の側に「またはブランク」を書く:
    //   <li><samp>O</samp> またはブランク: 出力専用</li>
    // 読まないと**ブランクが落ちる**。この欄はブランクが `O` と同じ意味なので、
    // 選べないと「既定へ戻す」ができなくなる。
    const orBlank = /^(?:またはブランク|or blank)\s*[:：]\s*([\s\S]*)$/u.exec(meaning);
    const single = /^([A-Z0-9])(?:\s*[（(].*[）)])?$/u.exec(term);
    if (orBlank && single) {
      addBlank(orBlank[1].trim());
      if (!options.some(o => o.value === single[1])) {
        options.push({ label: T.option(single[1], orBlank[1].trim().slice(0, 40)), value: single[1] });
      }
      return;
    }

    // 「B」「B (入出力共用)」の形。英数字1文字だけを値として採る。
    // 数字も落とさない（データ・タイプの「5」= 2 進文字が該当する）。
    const value = /^([A-Z0-9])(?:\s*[（(].*[）)])?$/u.exec(term);
    if (!value || options.some(o => o.value === value[1])) return;
    options.push({ label: T.option(value[1], meaning.slice(0, 40)), value: value[1] });
  };

  /**
   * 「注」に列挙されたデータ・タイプを足す。
   *
   * **対象を狭く取るのは `DBCS` の裏取りで行う。** 以前は「注:」の直後が
   * 「データ・タイプ」/「The data types」で始まることも要求していたが、
   * **書き出しは種別で揺れる**ので条件として弱く、実際に落としていた。
   *
   * | 種別 | 原典の注の書き出し | 旧条件 |
   * |---|---|---|
   * | 物理/論理・表示装置 | 「注: **データ・タイプ** J (専用)、E (択一)…」 | ○ |
   * | 印刷装置 | 「注: **O (混用) および G (グラフィック)** は…」 | **×** |
   *
   * 落ちると**実機が受ける値を弾く**ことになる（印刷装置 35 桁の `G` `O`）。
   *
   * 緩めても巻き込まないことは**原典の全件走査で裏を取ってある**。
   * `dds` と `dds-en` の全 HTML のうち「DBCS を含む注」を持つのは 3 ページだけで
   * （`FIELD-DSPF-valentries` / `FIELD-PF-ldata` / `FIELD-PRTF-prtdata`）、
   * いずれもデータ・タイプのページ。拾う値も DBCS のデータ・タイプに限られる。
   *
   * **注は 1 ページに複数ある**（「37 桁目に 0 を指定します」等）ので全部見る。
   * 先頭の 1 つだけを見ると、DBCS の注が 2 番目にあるページで落ちる。
   *
   * 窓を 160 → 200 文字にしたのは、**前置きの語を正規表現が消費しなくなった**分を
   * 埋めるため（実効範囲を元と同じに保つ）。原典の全件で確かめた限り
   * **160 と 200 で拾う値は同じ**なので、いまの結果を変える変更ではない。
   */
  function addNoteDataTypes(source) {
    const text = plain(source);
    for (const note of text.matchAll(/(?:注|Notes?)\s*[:：]\s*([\s\S]{0,200})/gu)) {
      // 「DBCS」を含む注だけを対象にする（データ・タイプの説明であることの裏取り）。
      if (!/DBCS/u.test(note[1])) continue;
      for (const m of note[1].matchAll(/\b([A-Z])\s*[（(]([^)）]{1,12})[）)]/gu)) {
        if (options.some(o => o.value === m[1])) continue;
        options.push({ label: T.option(m[1], m[2]), value: m[1] });
      }
    }
  }

  // 値の並べ方は 2 通りある。ページによって使い分けられているので両方読む。
  //   定義リスト  <dt>B</dt><dd>入力と出力の両方が可能</dd>   （物理/論理・表示装置）
  //   表          <tr><td>S</td><td>ゾーン 10 進数</td></tr>  （印刷装置）
  // 片方だけだと印刷装置の選択欄が丸ごと落ちる。
  for (const match of html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)) {
    addOption(plain(match[1]), plain(match[2]));
  }

  // **3 つ目の並べ方——箇条書き。** 印刷装置の 38 桁目（使用目的）はこの形しか持たず、
  //   <li><samp class="ph tt">O</samp> またはブランク: 出力専用</li>
  // 定義リストでも表でもないため**選択肢が丸ごと空**になっていた（`inputType: "text"`）。
  //
  // **`<samp>` で始まる `<li>` だけ**を採る。同じページの他の箇条書き
  // （「位置は無効です。」等の散文）は `<samp>` で始まらないので当たらない。
  // 巻き込まないことは原典の全件走査で確かめた——`dds` と `dds-en` の全 HTML で
  // この形を持つのは `FIELD-PRTF-prtuse.html` の日英 2 件だけ。
  for (const item of html.matchAll(/<li[^>]*>\s*<samp[^>]*>([\s\S]*?)<\/samp>([\s\S]*?)<\/li>/gi)) {
    addOption(plain(item[1]), plain(item[2]));
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

/**
 * 本文にしか無いブランクを足す（`BLANK_FROM_PROSE`）。
 * **先頭に置く**——原典の一覧はブランクを先に挙げるのが通例で、画面の並びを揃える。
 */
function addProseBlank(detail, typeKey, column) {
  const entry = BLANK_FROM_PROSE.find(b => b.type === typeKey && b.column === column);
  if (!entry) return detail;
  if (detail.options.some(o => o.value === "")) return detail;
  const meaning = entry.meaning[LANG] ?? entry.meaning.ja;
  return {
    ...detail,
    options: [{ label: T.blank(meaning), value: "" }, ...detail.options]
  };
}

const columns = JSON.parse(readFileSync(join(NAV, "dds-keyword-columns.json"), "utf8"));
// **欄の名前は言語別**。英語版は `dds-field-labels.en.json`（原典の英語ページから生成）。
// 無ければ日本語版に落ちる（RPG III と同じ——出せないより日本語でも出る方がよい）。
const labelFile = LANG === "ja" ? "dds-field-labels.json" : `dds-field-labels.${LANG}.json`;
const labels = JSON.parse(
  readFileSync(join(NAV, existsSync(join(NAV, labelFile)) ? labelFile : "dds-field-labels.json"), "utf8")
);

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
    const detail = addProseBlank(
      page ? parseDetail(page.file) : { help: undefined, options: [] },
      type.key,
      start
    );

    // 45-80 桁は定位置項目ではないため、桁ごとの説明ページが無い。
    const keywordArea = start >= 45;

    const base = {
      // 入力欄の名前は表示言語に依らない内部キー。桁で決める。
      name: `C${start}`,
      description: `${label}${T.columns(length > 1 ? `${start}-${end - 1}` : `${start}`)}`,
      help:
        detail.help ??
        (keywordArea ? T.keywordHelp : undefined),
      required: false,
      sourceStart: start,
      sourceLength: length,
      attributes: {
        characterSet: "upper",
        maxLength: length,
        // **列挙が「制限」か「候補」か。** 実機で全空間（1 文字なら 37 通り）を
        // 試して原典と一致した欄だけ `true`。それ以外は `false`＝候補にすぎない。
        //
        // 確かめずに `true` にすると**正しいソースを弾く**。実際、印刷装置の 35 桁は
        // 原典に無い `G` / `O` を実機が受ける（`verify/probe-confirm.mjs`）。
        // `false` なら画面は候補つきの自由入力になり、lint も咎めない。
        ...(detail.options.length >= 2
          ? { restricted: PROVEN_COMPLETE.has(`${type.key}:${start}`) }
          : {}),
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
    description: T.fileDescription(T.title[type.key]),
    help: T.fileHelp(T.title[type.key]),
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
