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
 * ## 様式（レコード）の参照は別の表
 *
 * `SFLCTL` / `ERASE` / `PASSRCD` / `MNUBARDSP` / `MNUBARCHC` / `HLPRCD` は
 * **様式**を指す。項目の改名では触らず、様式の改名でだけ追う（`RECORD_ARGUMENTS`）。
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

/**
 * 様式（レコード）名を採る定位置の引数。
 *
 * ## 実機で確かめたもの
 *
 * `SFLCTL` / `ERASE` / `PASSRCD` は、**存在しない様式を指すとコンパイルが通らない**
 * （IBM i 7.3。`.aidev/works/20260828-dds-record-rename/verify/probe-record-names.mjs`）。
 * 追随しないと壊れることが確かめられている。
 *
 * `HLPRCD` は**存在しない様式を指しても通る**（同 probe の H4）。コンパイラーが
 * 見ていないので、**追随しないと実行時まで気付けない**——追う値打ちはむしろ大きい。
 * ただし裏を返すと、誤って追っても実機は教えてくれない。だから
 * 「ファイル名を省いたときだけ」という原典の条件を厳密に守る。
 *
 * ## 原典だけで決めたもの
 *
 * `MNUBARDSP` / `MNUBARCHC` は**実機で確かめられていない**（メニュー・バーの
 * 通る形を組めなかった。対照が落ちたので判定できない）。原典の文は明確なので
 * 表には入れるが、確かめた根拠が違うことを `origin` に書き分けてある。
 */
interface RecordArgumentRule {
  readonly positions: readonly number[] | "all";
  /** 引数がこの数より多いときは外部を指す（`HLPRCD` のファイル名つき）。 */
  readonly onlyWhenArgumentCountIs?: number;
  /** 原典の引用と、実機で確かめたかどうか。 */
  readonly origin: string;
}

const RECORD_ARGUMENTS: ReadonlyMap<string, RecordArgumentRule> = new Map([
  [
    "SFLCTL",
    {
      positions: [0],
      origin:
        "実機で確認済み。「サブファイル・レコード様式の名前を…指定しなければなりません」"
    }
  ],
  [
    "PASSRCD",
    {
      positions: [0],
      origin:
        "実機で確認済み。「record-format-name は…ファイル内に存在するものでなければなりません」"
    }
  ],
  [
    "ERASE",
    {
      // `ERASE(record-name-1 [record-name-2 ...[record-name-20]])` — 全部が様式名。
      positions: "all",
      origin:
        "実機で確認済み。「パラメーター値として指定するレコード様式は、" +
        "このファイル内に入っているものでなければなりません」"
    }
  ],
  [
    "HLPRCD",
    {
      positions: [0],
      // **ファイル名を添えると外部を指す。** 原典:
      // 「ファイル名を指定しない場合には、レコード様式は定義中のファイルに
      //   入っていなければなりません」
      onlyWhenArgumentCountIs: 1,
      origin:
        "実機で両方の形が通ることを確認（存在しない様式でも通るのでコンパイラーは見ていない）。" +
        "「ファイル名を指定しない場合には、レコード様式は定義中のファイルに入っていなければなりません」"
    }
  ],
  [
    "MNUBARDSP",
    {
      // 形式が 2 つあり、`MNUBARDSP[(&pull-down-input)]` の 1 つ目は様式名ではない。
      // `&` で始まる引数は下の走査が除くので、位置だけで決めても壊れない。
      positions: [0],
      origin:
        "**原典のみ**（実機で通る形を組めなかった）。" +
        "「メニュー・バー・レコードは、定義中のレコードと同じファイル内に存在しなければなりません」"
    }
  ],
  [
    "MNUBARCHC",
    {
      positions: [1],
      origin:
        "**原典のみ**（実機で通る形を組めなかった）。" +
        "「指定するレコードは、ファイル内に存在するものでなければならず」"
    }
  ]
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

/**
 * 名前として使える形か。`*FLD` のような予約語と数値を弾く。
 *
 * **`&名前` もここで落ちる**（先頭の `&` は名前に使える文字ではない）。
 * 様式の参照でこれが効く——`MNUBARDSP` には `MNUBARDSP[(&pull-down-input)]` と
 * いう形式があり、1 つ目の引数を無条件に様式名として扱うと潜在フィールドの名前を
 * 書き換える。項目の参照では `&` を**先に外してから**渡すので影響しない。
 */
function looksLikeName(text: string): boolean {
  return /^[A-Za-z#$@][A-Za-z0-9_#$@]{0,9}$/u.test(text);
}

/**
 * キーワード欄から、**このソースの項目**を指している箇所を集める。
 *
 * 見つけるだけで、書き換えはしない（`renameFieldReferences` が使う）。
 */
function scanKeywords(
  keywords: string,
  collect: (
    keyword: string,
    args: readonly Argument[],
    push: (reference: DdsNameReference) => void
  ) => void
): DdsNameReference[] {
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

    collect(split.name, splitArguments(split.inner, rawStart + split.innerStart), reference =>
      references.push(reference)
    );
  }

  return references;
}

/**
 * キーワード欄から、**このソースの項目**を指している箇所を集める。
 *
 * 見つけるだけで、書き換えはしない（`renameFieldReferences` が使う）。
 */
export function findFieldReferences(keywords: string): readonly DdsNameReference[] {
  return scanKeywords(keywords, (keyword, args, push) => {
    const rule = FIELD_ARGUMENTS.get(keyword);
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
        push({
          keyword,
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
      push({ keyword, name: argument.text, start: argument.start, end: argument.end, rule: "positional" });
    });
  });
}

/**
 * キーワード欄から、**このソースの様式**を指している箇所を集める。
 *
 * 項目とは別の表を引く（`RECORD_ARGUMENTS`）。`&` の付いた引数は**様式名ではない**
 * ——`MNUBARDSP` には `MNUBARDSP[(&pull-down-input)]` という形式があり、
 * 位置だけで決めると潜在フィールドの名前を様式名として書き換える。
 */
export function findRecordReferences(keywords: string): readonly DdsNameReference[] {
  return scanKeywords(keywords, (keyword, args, push) => {
    const rule = RECORD_ARGUMENTS.get(keyword);
    if (rule === undefined) return;
    if (
      rule.onlyWhenArgumentCountIs !== undefined &&
      args.length !== rule.onlyWhenArgumentCountIs
    ) {
      return;
    }

    args.forEach((argument, index) => {
      if (rule.positions !== "all" && !rule.positions.includes(index)) return;
      // `&名前`（潜在フィールド）は `looksLikeName` が弾く——先頭の `&` は
      // 名前に使える文字ではない。**ここで二重に見ない**（同じ規則を 2 か所に
      // 置くと、片方だけ緩めたときに黙って守りが消える）。
      if (!looksLikeName(argument.text)) return;
      push({ keyword, name: argument.text, start: argument.start, end: argument.end, rule: "positional" });
    });
  });
}

/**
 * 参照している名前を置き換えたキーワード欄。一致が無ければ**元のまま**の文字列を返す。
 *
 * **文字列置換ではない。** 引数に切ってから丸ごと一致で見るので、
 * `&CUSTNO2` の中の `CUSTNO` は変わらない。
 */
export function renameFieldReferences(keywords: string, from: string, to: string): string {
  return renameIn(findFieldReferences(keywords), keywords, from, to);
}

/**
 * 様式を指している名前を置き換えたキーワード欄。一致が無ければ**元のまま**。
 */
export function renameRecordReferences(keywords: string, from: string, to: string): string {
  return renameIn(findRecordReferences(keywords), keywords, from, to);
}

function renameIn(
  found: readonly DdsNameReference[],
  keywords: string,
  from: string,
  to: string
): string {
  const target = from.trim().toUpperCase();
  if (target.length === 0) return keywords;

  const hits = found.filter(reference => reference.name.toUpperCase() === target);
  if (hits.length === 0) return keywords;

  // **後ろから当てる。** 前から当てると、置き換えで長さが変わって後続の位置がずれる。
  let text = keywords;
  for (const hit of [...hits].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, hit.start) + to.toUpperCase() + text.slice(hit.end);
  }
  return text;
}
