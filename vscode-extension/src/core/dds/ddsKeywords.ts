/**
 * キーワード欄（45-80 桁）を**読める形に分ける**。
 *
 * 原典（`表示装置ファイルの DDS キーワード項目 (45 - 80 桁目)`）:
 * > 表示装置ファイルを定義するキーワード項目は、45 - 80 桁目 (機能欄) に記入します。
 *
 * ## ここでは意味づけをしない
 *
 * 引数の中身（`DSPATR(RI)` の `RI` が妥当か）は見ない。原典の構文は散文混じりで、
 * 機械的な検証に耐える形になっていない。ここがやるのは**どこで切れるか**だけ。
 *
 * ## 何が読めなくなるか
 *
 * `toLogicalUnits` はキーワード継続行を**空白 1 個で連結**して 1 本の文字列にする。
 * そのままでは「どこで切れているか」が読めない——`DSPATR(RI) COLOR(RED) CHECK(RZ)` が
 * 1 つの塊に見える。切り分ければ、1 つずつに原典の解説を当てられる。
 */

/** キーワード欄の 1 区切り。 */
export interface KeywordEntry {
  /** 大文字化した名前。リテラルなら空。 */
  readonly name: string;
  /** 括弧の中（生テキスト。括弧自体は含まない）。引数を取らなければ undefined。 */
  readonly parameters?: string;
  /** 元のテキストそのまま。**チップに出すのはこれ**（書いてあるとおりを見せる）。 */
  readonly raw: string;
  /**
   * 定数（固定情報）のリテラルは**キーワードではない**。
   *
   * 区別しないと、定数を選ぶたびに「原典に無いキーワード」の印が付く。
   */
  readonly kind: "keyword" | "literal";
}

/**
 * 原典から生成したキーワードの解説。
 *
 * 実体は `resources/completion/dds-keywords{,.en}.json` の 1 件で、
 * 生成は `docs/origin/generate-dds-keywords.mjs`、検査は `docs/origin/verify-dds-keywords.mjs`。
 * **core はファイルを読まない**——ホストが読んで渡す。
 */
export interface DdsKeywordHelp {
  readonly name: string;
  /** 和名 / 英名（「音響警報」「Audible Alarm」）。 */
  readonly title: string;
  /** 使用レベル（`file` / `record` / `field` など）。判別できなかったものは未設定。 */
  readonly level?: readonly string[];
  readonly description?: string;
  /** 構文。書き方が複数あるキーワードは複数行になる。 */
  readonly syntax?: readonly string[];
  readonly hasParameters?: boolean;
}

/**
 * キーワード欄を区切りに分ける。
 *
 * ■ 引用符の外でだけ括弧を数える
 *   `DFT('(A)')` は 1 つ。括弧だけを数えると引用符の中で深さが狂う。
 *   `''` は引用符の中のエスケープなので、そこで閉じない。
 *
 * ■ 閉じないものを捨てない
 *   `DSPATR(RI` のように閉じ括弧が無くても、**行末までを 1 区切りとして返す**。
 *   捨てると「書いたのに画面に無い」が起き、原因が掴めなくなる。
 */
export function parseKeywordEntries(text: string): readonly KeywordEntry[] {
  const entries: KeywordEntry[] = [];
  let index = 0;

  while (index < text.length) {
    if (text[index] === " " || text[index] === "\t") {
      index += 1;
      continue;
    }

    const start = index;

    // 引用符で始まればリテラル（定数の固定情報）。
    if (text[index] === "'") {
      index = skipQuoted(text, index);
      entries.push({ name: "", raw: text.slice(start, index), kind: "literal" });
      continue;
    }

    // 名前は括弧・空白・引用符の手前まで。
    while (index < text.length && !/[\s('"]/u.test(text[index])) index += 1;
    const name = text.slice(start, index);

    if (text[index] !== "(") {
      entries.push({ name: name.toUpperCase(), raw: name, kind: "keyword" });
      continue;
    }

    const open = index;
    index = skipParenthesized(text, index);
    // 閉じていれば最後の 1 文字が `)`。閉じていなければ行末まで。
    const closed = text[index - 1] === ")";
    const parameters = text.slice(open + 1, closed ? index - 1 : index);
    entries.push({
      name: name.toUpperCase(),
      parameters,
      raw: text.slice(start, index),
      kind: "keyword"
    });
  }

  return entries;
}

/** 開きの引用符から、閉じの引用符の**次**まで。`''` は閉じない。 */
function skipQuoted(text: string, from: number): number {
  let index = from + 1;
  while (index < text.length) {
    if (text[index] !== "'") {
      index += 1;
      continue;
    }
    if (text[index + 1] === "'") {
      index += 2; // エスケープされた引用符
      continue;
    }
    return index + 1;
  }
  return index;
}

/** 開き括弧から、対応する閉じ括弧の**次**まで。引用符の中は数えない。 */
function skipParenthesized(text: string, from: number): number {
  let index = from;
  let depth = 0;

  while (index < text.length) {
    const character = text[index];
    if (character === "'") {
      index = skipQuoted(text, index);
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }

  return index;
}

/**
 * 名前で解説を引く。**2 段**で引く。
 *
 * 原典は `CAnn`（`CA01` - `CA24` の総称）と書き、ソースには `CA03` と書かれる。
 * そのままでは引けないので、**末尾 2 桁を `nn` に替えて**引き直す。
 *
 * 表を 24 件へ展開しないのは、原典との 1:1 対応を崩さないため
 * （`20260827-dds-keyword-cann` の `decisions.md` D3）。表で `nn` を含むのは
 * `CAnn` / `CFnn` の 2 件だけ。
 */
/** キーワードを書ける場所。原典の「使用レベル」に合わせた語。 */
export type KeywordLevel = "file" | "record" | "field";

/**
 * そのレベルで**候補に出す**キーワード。
 *
 * **絞り込みは候補の並びにだけ効かせる。** 書けるかどうかの検証には使わない
 * ——レベルの判定を誤ると、正しい記述を拒否することになる。
 *
 * **レベルを持たないものは常に出す**（AGENTS.md「判別できなかったものは
 * どのレベルでも出す」）。出すべきものを隠すより余分に出す方が害が少ない。
 */
export function keywordsForLevel(
  help: readonly DdsKeywordHelp[],
  level: KeywordLevel
): readonly DdsKeywordHelp[] {
  return help.filter(
    entry => !entry.level || entry.level.length === 0 || entry.level.includes(level)
  );
}

export function findKeywordHelp(
  name: string,
  table: readonly DdsKeywordHelp[]
): DdsKeywordHelp | undefined {
  const upper = name.toUpperCase();
  const direct = table.find(entry => entry.name.toUpperCase() === upper);
  if (direct !== undefined) return direct;

  const numbered = /^([A-Z]+)(\d{2})$/u.exec(upper);
  if (numbered === null) return undefined;

  const generic = `${numbered[1]}nn`.toUpperCase();
  return table.find(entry => entry.name.toUpperCase() === generic);
}
