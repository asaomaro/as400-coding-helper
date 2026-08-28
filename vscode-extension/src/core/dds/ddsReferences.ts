import { parseKeywordEntries } from "./ddsKeywords";

/**
 * キーワードの引数が**このソースの中の項目**を指している箇所。
 *
 * ## なぜ必要か
 *
 * 項目の名前を変えても、その名前を引数に持つキーワードは追随しなかった。
 * プロパティに「追随しません」と断りが出ていたが、**その断り自体が誤り**で、
 * 例に挙がっていた `SFLCTL` が指すのは項目ではなく**様式**だった。
 *
 * ## 見つけ方は 2 本立て
 *
 * ■ 規則 A: `&名前`（プログラム - システム間フィールド）
 *   原典が `&` を「このソースの中のフィールド」の印として一貫して使う。
 *   `CHOICE`「プログラム - システム間フィールドとして: **&フィールド名**
 *   指定するフィールドは、選択フィールドと**同じレコード内に存在**しなければならず」、
 *   `CHCCTL`「**フィールドは、定義中のフィールドと同じレコード内に定義する必要があり**」、
 *   `SFLCSRRRN`「フィールドは…**サブファイル制御レコード様式に定義する必要があります**」。
 *
 *   **`&` が付いていれば外部オブジェクトではありえない。** 帳票の
 *   `&library-name-field` も「ライブラリー名**が入るフィールド**」であって
 *   ライブラリーそのものではない。だから**キーワードごとの表を要さない**
 *   ——表は書き漏らすと黙って追随しないが、この規則は書き漏らしようがない。
 *
 * ■ 規則 B: 定位置の引数（下の `FIELD_ARGUMENTS`）
 *   原典が「このファイル内の項目」と書いているものだけ。表は手で書く
 *   （散文からは機械的に決まらない）ので、**原典の引用を各行に添える**。
 *   網羅は `docs/origin/verify-dds-references.mjs` が見張る。
 *
 * ## 様式（レコード）の参照は入れていない
 *
 * `SFLCTL` / `ERASE` / `PASSRCD` / `MNUBARDSP` / `MNUBARCHC` / `HLPRCD` は
 * 原典上「このファイル内の様式」だが、**デザイナに様式を改名する手段が無い**
 * （名前の入力欄があるのは項目のプロパティだけ）。到達しないので入れない。
 * 判断したことは `NOT_FOLLOWED` に残す（検査が「書き忘れ」と区別できるように）。
 */

/** 項目名を採る定位置の引数。**キーワード名は大文字**。 */
interface FieldArgumentRule {
  /** 0 始まりの引数の位置。 */
  readonly positions: readonly number[];
  /** その形式のときだけ有効（先頭の引数を見る）。 */
  readonly onlyWhenFirstIs?: string;
  /** 原典の引用。なぜその位置が項目名なのか。 */
  readonly origin: string;
}

const FIELD_ARGUMENTS: ReadonlyMap<string, FieldArgumentRule> = new Map([
  [
    "CSRLOC",
    {
      positions: [0, 1],
      origin:
        "CSRLOC(field-name-1 field-name-2) / " +
        "「それぞれカーソル位置の行番号 (field-name-1) と桁番号 (field-name-2) を" +
        "指定する 2 つのフィールドの名前をパラメーター値として指定します」"
    }
  ],
  [
    "HLPARA",
    {
      positions: [1],
      // **形式が 5 つある。** `*FLD` のときだけ 2 つ目が項目名で、
      // `HLPARA(1 1 24 80)` の 2 つ目は桁番号。位置だけで決めると数字を名前として扱う。
      onlyWhenFirstIs: "*FLD",
      origin: "HLPARA(*FLD field-name [choice-number])"
    }
  ]
]);

/**
 * **項目名を追わないと決めたキーワード**と、その理由。
 *
 * 検査（`verify-dds-references.mjs`）が「まだ判断していない」と区別するために要る。
 * 新しいキーワードが原典に増えたら、ここか `FIELD_ARGUMENTS` に書くまで検査が落ちる。
 */
export const NOT_FOLLOWED: ReadonlyMap<string, string> = new Map([
  // ■ 様式（レコード）を指す。原典上はこのファイル内だが、改名の手段が無いので追わない。
  ["SFLCTL", "様式を指す（改名の手段が無い）"],
  ["ERASE", "様式を指す（改名の手段が無い）"],
  ["PASSRCD", "様式を指す（改名の手段が無い）"],
  ["MNUBARDSP", "様式を指す（改名の手段が無い）。&choice-field は規則 A が拾う"],
  ["MNUBARCHC", "様式を指す（改名の手段が無い）。&return-field は規則 A が拾う"],
  ["HLPRCD", "様式を指す（ファイル名を省くとこのファイル内）。改名の手段が無い"],
  // ■ 外部のオブジェクトを指す。**触ってはいけない。**
  ["REF", "外部のデータベース・ファイル / 様式"],
  ["REFFLD", "外部の様式 / フィールド"],
  ["MSGID", "外部のメッセージ・ファイル"],
  ["MSGCON", "外部のメッセージ・ファイル"],
  ["CHKMSGID", "外部のメッセージ・ファイル（&message-data-field は規則 A が拾う）"],
  ["HLPPNLGRP", "外部のパネル・グループ"],
  ["HLPDOC", "外部の文書 / フォルダー"],
  ["HLPSCHIDX", "外部の探索索引"],
  ["HLPSEQ", "外部のグループ名"],
  ["ALIAS", "別名の宣言（参照ではない）"],
  ["ALTNAME", "別名の宣言（参照ではない）"],
  ["FLDCSRPRG", "カーソルの進み先の指定。原典の形式が `*NEXT | name field` で判別が要る"],
  ["CDEFNT", "外部のコード化フォント"],
  ["FNTCHRSET", "外部の文字セット"],
  ["FONTNAME", "外部のフォント"],
  ["GDF", "外部のグラフィックス・データ・ファイル"],
  ["OVERLAY", "帳票では外部のオーバーレイ（表示装置の OVERLAY は引数を採らない）"],
  ["PAGSEG", "外部のページ・セグメント"],
  ["AFPRSC", "外部の資源"],
  ["INVDTAMAP", "外部のデータ・マップ"],
  ["INVMMAP", "外部の媒体マップ"],
  ["DOCIDXTAG", "文書の索引タグ（外部の属性名）"],
  ["STRPAGGRP", "ページ・グループ名（このソースの項目ではない）"],
  ["DATFMT", "日付の書式（名前ではない）"],
  ["TIMFMT", "時刻の書式（名前ではない）"],
  ["COLOR", "色の名前（名前ではない）"],
  ["DSPSIZ", "画面サイズ条件名（項目ではない）"],
  ["DSPMOD", "画面サイズ条件名（項目ではない）"],
  ["SST", "部分ストリング。原典の形式に位置の判別が要る"],
  ["CONCAT", "連結する項目。物理ファイルのキーワード（画面・帳票では使わない）"],
  ["JREF", "結合の参照。物理/論理ファイルのキーワード"],
  ["JFILE", "結合するファイル。物理/論理ファイルのキーワード"],
  ["PFILE", "元の物理ファイル。物理/論理ファイルのキーワード"],
  ["JDUPSEQ", "結合の順序。物理/論理ファイルのキーワード"],
  ["JFLD", "結合するフィールド。物理/論理ファイルのキーワード"],
  ["RENAME", "物理ファイルのフィールドの改名。物理/論理ファイルのキーワード"],
  ["FORMAT", "様式の借用。物理/論理ファイルのキーワード"],
  ["REFACCPTH", "アクセス・パスの借用。物理/論理ファイルのキーワード"],
  ["ALTSEQ", "外部の変換テーブル"],
  ["TRNTBL", "外部の変換テーブル"],
  ["CCSID", "コード化文字セット ID（名前ではない）"],
  ["LINE", "帳票の線。&position-down-field は規則 A が拾う"],
  ["POSITION", "帳票の位置。&position-down-field は規則 A が拾う"],
  ["BOX", "帳票の枠。&…-field は規則 A が拾う"],
  ["FONT", "フォント識別子。&font-identifier-field は規則 A が拾う"],
  ["DTASTMCMD", "データ・ストリーム・コマンド。&text-field は規則 A が拾う"],
  ["SFLSIZ", "レコード数。&…-field は規則 A が拾う"],
  ["WINDOW", "ウィンドウの位置。&…-field は規則 A が拾う"],
  ["SFLCSRRRN", "&relative-record だけ。規則 A が拾う"],
  ["CHCCTL", "&control-field だけがこのソース。規則 A が拾う"],
  ["CHOICE", "選択項目テキスト。&フィールド名 は規則 A が拾う"],
  ["DSPATR", "表示属性。&program-to-system-field は規則 A が拾う"],
  ["SFLRCDNBR", "定義中のフィールド自身（引数は CURSOR / *TOP）"],
  ["INDTXT", "標識と説明（項目ではない）"],
  ["CHANGE", "応答標識（項目ではない）"]
]);

export interface DdsNameReference {
  /** キーワード名（大文字）。 */
  readonly keyword: string;
  /** 参照している名前（原文のまま。`&` は含まない）。 */
  readonly name: string;
  /** キーワード欄の中での位置（0 始まり・`end` は含まない。`&` は含まない）。 */
  readonly start: number;
  readonly end: number;
  /** どちらの規則で見つけたか。 */
  readonly rule: "ampersand" | "positional";
}

/** 引数 1 つ分。キーワード欄の中の位置つき。 */
interface Argument {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * 括弧の中を引数に切る。
 *
 * **引用符の外の空白でだけ切る**——`CHOICE(1 '選択 項目')` の中の空白で割ると
 * テキストが 2 つの引数になる。`''` は引用符の中のエスケープなので、そこで閉じない。
 */
function splitArguments(text: string, offset: number): Argument[] {
  const args: Argument[] = [];
  let index = 0;
  let quoted = false;
  let start = -1;

  const flush = (end: number): void => {
    if (start < 0) return;
    args.push({ text: text.slice(start, end), start: offset + start, end: offset + end });
    start = -1;
  };

  while (index < text.length) {
    const ch = text[index];
    if (ch === "'") {
      if (quoted && text[index + 1] === "'") {
        index += 2;
        continue;
      }
      quoted = !quoted;
      if (start < 0) start = index;
      index += 1;
      continue;
    }
    if (!quoted && (ch === " " || ch === "\t")) {
      flush(index);
      index += 1;
      continue;
    }
    if (start < 0) start = index;
    index += 1;
  }
  flush(text.length);
  return args;
}

/** `KEYWORD(...)` を名前と括弧の中に割る。括弧が無ければ undefined。 */
function splitKeyword(
  raw: string
): { readonly name: string; readonly inner: string; readonly innerStart: number } | undefined {
  const open = raw.indexOf("(");
  if (open < 0) return undefined;
  const close = raw.lastIndexOf(")");
  // 閉じていない欄も読む（`parseKeywordEntries` が行末までを 1 区切りで返すため）。
  const end = close > open ? close : raw.length;
  return {
    name: raw.slice(0, open).trim().toUpperCase(),
    inner: raw.slice(open + 1, end),
    innerStart: open + 1
  };
}

/** 名前として使える形か。`*FLD` のような予約語と数値を弾く。 */
function looksLikeName(text: string): boolean {
  return /^[A-Za-z#$@][A-Za-z0-9_#$@]{0,9}$/u.test(text);
}

/**
 * キーワード欄から、**このソースの項目**を指している箇所を集める。
 *
 * 見つけるだけで、書き換えはしない（`renameFieldReferences` が使う）。
 */
export function findFieldReferences(keywords: string): readonly DdsNameReference[] {
  const references: DdsNameReference[] = [];

  // `parseKeywordEntries` は位置を返さないので、**読んだところまでを覚えて**前へ進む。
  // 先頭から探し直すと、同じ綴りが 2 つあるとき（`DSPATR(RI) DSPATR(&X)`）に
  // 同じ位置を 2 回返す。
  let cursor = 0;

  for (const entry of parseKeywordEntries(keywords)) {
    const rawStart = keywords.indexOf(entry.raw, cursor);
    if (rawStart >= 0) cursor = rawStart + entry.raw.length;
    if (entry.kind !== "keyword") continue;
    const split = splitKeyword(entry.raw);
    if (!split || rawStart < 0) continue;

    const args = splitArguments(split.inner, rawStart + split.innerStart);

    const rule = FIELD_ARGUMENTS.get(split.name);
    const positional =
      rule !== undefined &&
      (rule.onlyWhenFirstIs === undefined ||
        (args[0]?.text ?? "").toUpperCase() === rule.onlyWhenFirstIs)
        ? rule.positions
        : [];

    args.forEach((argument, index) => {
      // ■ 規則 A: `&名前`。**キーワードを問わない。**
      if (argument.text.startsWith("&")) {
        const name = argument.text.slice(1);
        if (!looksLikeName(name)) return;
        references.push({
          keyword: split.name,
          name,
          start: argument.start + 1,
          end: argument.end,
          rule: "ampersand"
        });
        return;
      }
      // ■ 規則 B: 定位置。
      if (!positional.includes(index)) return;
      if (!looksLikeName(argument.text)) return;
      references.push({
        keyword: split.name,
        name: argument.text,
        start: argument.start,
        end: argument.end,
        rule: "positional"
      });
    });
  }

  return references;
}

/**
 * 参照している名前を置き換えたキーワード欄。一致が無ければ**元のまま**の文字列を返す。
 *
 * **文字列置換ではない。** 引数に切ってから丸ごと一致で見るので、
 * `&CUSTNO2` の中の `CUSTNO` は変わらない。
 */
export function renameFieldReferences(keywords: string, from: string, to: string): string {
  const target = from.trim().toUpperCase();
  if (target.length === 0) return keywords;

  const hits = findFieldReferences(keywords).filter(
    reference => reference.name.toUpperCase() === target
  );
  if (hits.length === 0) return keywords;

  // **後ろから当てる。** 前から当てると、置き換えで長さが変わって後続の位置がずれる。
  let text = keywords;
  for (const hit of [...hits].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, hit.start) + to.toUpperCase() + text.slice(hit.end);
  }
  return text;
}
