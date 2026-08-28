import {
  DDS_COLUMNS,
  ddsField,
  ddsName,
  isDdsBlankLine,
  isDdsCommentLine
} from "../ddsLayout";

/**
 * DDS の行を「論理単位」にまとめる。**印刷装置・表示装置に共通**。
 *
 * DDS では**キーワードだけの行は直前のレコード／項目の続き**なので、
 * 行を 1 本ずつ処理すると桁送りやキーワードの持ち主を取り違える。
 *
 * 実際に `CUSTRPT.prtf` で踏んだ:
 * ```
 *   A          R HEADING                   SKIPB(1)
 *   A                                      SPACEA(2)   ← HEADING のキーワード
 *   A                                    30'顧客一覧表'
 * ```
 * 2 行目を独立した行として扱うと、見出しと明細が同じ行に重なる。
 *
 * この性質は PRTF 固有ではないので、DSPF からも同じものを使う。
 *
 * ■ 条件付けの行は「次」に付く（表示装置ファイルで効く）
 *   原典（`条件付け (7 - 16 桁目)`）:
 *   > フィールドについて条件を設定する際には、そのフィールド名 (または固定情報) と
 *   > **最後の (または唯一の) 標識は同じ行に指定**しなければなりません。
 *
 *   つまり条件が複数行に分かれる場合、**先行する行が条件の続き**で、項目は最後の行にある。
 *   キーワードの継続行が「直前に付く」のと**向きが逆**なので、両者を判別する:
 *   キーワード欄が空で条件付け欄に何か書いてあれば、**次の単位への前置き**とみなす。
 *
 *   なお PRTF ではこの判別は結果を変えない（キーワード欄が空の行は、
 *   直前に連結しても空文字を足すだけで `keywords` が変わらないため）。
 */

/**
 * キーワード欄の開始桁（45）。位置欄の直後から始まる。
 *
 * 桁の基準は `DDS_COLUMNS` の 1 か所だけに置きたいので、数値を直接書かず導出する。
 */
export const DDS_KEYWORD_AREA_START = DDS_COLUMNS.position[1] + 1;

/** 条件付け欄（7-16 桁）。原典の表示装置ファイルの区切りに合わせる。 */
export const DDS_CONDITIONING: readonly [number, number] = [7, 16];

/**
 * 条件ごとのキーワード欄。**キーワードにも条件が付く。**
 *
 * 原典（`表示装置ファイルの条件付け (7 - 16 桁目)`）:
 * > ユーザー・プログラムでは、オプション標識をオン (16 進数 F1) またはオフ (16 進数 F0) に
 * > セットすることにより、**フィールドまたはキーワード**を選択することができます。
 *
 * `30 DSPATR(RI)` のような形は、**その項目の条件とは別の条件**で効いたり効かなかったりする。
 * 連結した `keywords` だけを持っていると、この条件が消えて**常に効く**ことになる
 * （実際そうなっており、標識を倒しても反転表示が消えなかった）。
 *
 * ここでは**桁を切り出すところまで**を持ち、条件の解釈（`readConditioning`）はしない
 * ——`ddsConditioning` がこのファイルを import しているので、逆向きに import すると環状になる。
 */
export interface RawKeywordGroup {
  /**
   * 条件を読むための行群。代表行の分は**空**（項目自身の条件は
   * `LogicalUnit.conditioningLines` が持っており、出た時点で自分のキーワードは効く）。
   */
  readonly conditioningLines: readonly string[];
  /** その行（と継続行）の機能欄。 */
  readonly keywords: string;
  /** 1 始まり。キーワードが書かれている行。 */
  readonly sourceLine: number;
  /**
   * 条件を書き換えるときに**置き換える範囲**（1 始まり・昇順）。
   * 先行する条件だけの行 → キーワードの行。**継続行は含めない**
   * （あちらはキーワードの続きで、条件の書き換えでは触らない）。
   */
  readonly sourceLines: readonly number[];
}

export interface LogicalUnit {
  readonly kind: "record" | "item";
  /** 単位の代表行（項目の桁を読む行）。 */
  readonly line: string;
  /** 1 始まり。 */
  readonly sourceLine: number;
  /** 代表行＋キーワード継続行のキーワード欄を連結したもの。 */
  readonly keywords: string;
  /**
   * 条件付けを読むための行群（先行する条件行 → 代表行 の順）。
   *
   * 条件付け欄は複数行にまたがるため、代表行だけでは条件を読めない。
   */
  readonly conditioningLines: readonly string[];
  /**
   * この単位に属するソース行（1 始まり・昇順）。**先行する条件行・代表行・キーワード継続行**。
   *
   * **削除の単位はこれ**——代表行だけ消すとキーワード継続行が孤児として残る。
   * 注記行・空行はどの単位にも属さないので**含まれない**（間に挟まっていても消さない）。
   * したがって連続とは限らない。
   */
  readonly sourceLines: readonly number[];
  /**
   * キーワード欄を**条件ごとに**分けたもの。連結すると `keywords` に一致する
   * （`test/unit/ddsConditionalAttributes.test.ts` で固定）。
   *
   * `keywords` は今までどおり**全部を繋いだもの**。`readConstant` / `fieldWidth` /
   * `readSpacing` / チップ表示 / `setKeywords` の 5 か所が読んでおり、
   * ここから条件つき分を引くとそれらの意味が変わる。**見え方の解決だけ**がこちらを見る。
   */
  readonly keywordGroups: readonly RawKeywordGroup[];
}

/** キーワード欄（45 桁以降）を取り出す。 */
export function keywordAreaOf(line: string): string {
  return line.slice(DDS_KEYWORD_AREA_START - 1).trimEnd();
}

/** 定数のリテラル（キーワード欄の先頭の `'…'`）。読む側と書く側で同じ形を使う。 */
const LEADING_CONSTANT = /^'((?:[^']|'')*)'/u;

/** 定数（キーワード欄の `'…'`）を取り出す。 */
export function readConstant(keywords: string): string | undefined {
  const match = LEADING_CONSTANT.exec(keywords.trim());
  return match ? match[1].replace(/''/gu, "'") : undefined;
}

/**
 * キーワード欄の**先頭のリテラルだけ**を差し替える。定数でなければ `undefined`。
 *
 * **後ろに続くキーワードは触らない。** DDS は `2'見出し'DSPATR(HI)` のように
 * リテラルの後ろにキーワードを書けるので、欄ごと置き換えると**キーワードが消える**。
 * 読む側（`readConstant`）と同じ正規表現を使い、規則を 2 か所に持たない。
 *
 * リテラル中の `'` は原典の書き方に合わせて `''` に重ねる（`readConstant` がこれを戻す）。
 */
export function replaceLeadingConstant(
  keywords: string,
  text: string
): string | undefined {
  const match = LEADING_CONSTANT.exec(keywords.trim());
  if (!match) {
    return undefined;
  }
  const leading = keywords.length - keywords.trimStart().length;
  const quoted = `'${text.replace(/'/gu, "''")}'`;
  return (
    keywords.slice(0, leading) + quoted + keywords.trim().slice(match[0].length)
  );
}

/**
 * 項目の種別。**定数（固定情報）か、名前つきフィールドか。**
 *
 * 原典（`桁数 (30 - 34 桁目)`）は固定情報に桁数を書かないと定めており、
 * 実装上も「名前欄が空で、キーワード欄がリテラルで始まる」ものが定数になる。
 * **描画（`dspfLayout`）と編集（`ddsEdit`）が同じ判定を使う**ために、規則はここに置く。
 */
export function unitItemKind(unit: LogicalUnit): "field" | "constant" {
  const name = ddsName(unit.line).trim();
  return name.length === 0 && readConstant(unit.keywords) !== undefined
    ? "constant"
    : "field";
}

/** 桁欄の数値を読む。空・数字以外は undefined。 */
export function readNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  if (!/^\d+$/u.test(trimmed)) return undefined;
  return Number(trimmed);
}

/** 条件付け欄（7-16 桁）の生の文字列。 */
export function conditioningAreaOf(line: string): string {
  const [start, end] = DDS_CONDITIONING;
  return line.slice(start - 1, end);
}

/**
 * DDS が読む機能欄の終わり（80 桁目）。
 *
 * **81 桁目以降は読まれない。** 実機で 80 桁を超える行を書くと、はみ出した部分は
 * 無かったことになり `CPD7508「閉じ引用符が無い」`で落ちる（2026-08-27・IBM i 7.3 で確認）。
 * 継続の判定を行全体で行うと、はみ出した文字を継続記号と誤読する。
 */
const DDS_KEYWORD_AREA_END = 80;

/** 機能欄（45-80 桁）。継続の判定と結合はこの範囲で行う。 */
function functionsArea(line: string): string {
  return line.slice(DDS_KEYWORD_AREA_START - 1, DDS_KEYWORD_AREA_END).trimEnd();
}

/** 引用符が閉じていないか。`''` は中のエスケープなので、そこでは閉じない。 */
function hasOpenQuote(text: string): boolean {
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "'") {
      index += 1;
      continue;
    }
    index += 1;
    // 開いた引用符。閉じを探す。
    for (;;) {
      if (index >= text.length) return true;
      if (text[index] !== "'") {
        index += 1;
        continue;
      }
      if (text[index + 1] === "'") {
        index += 2; // エスケープされた引用符
        continue;
      }
      index += 1;
      break;
    }
  }
  return false;
}

/** 継続の種類。**判定の優先順位は `-` → `+` → 引用符が開いている**（実機で確認）。 */
type Continuation = "minus" | "plus" | "open" | undefined;

function continuationOf(segment: string, accumulated: string): Continuation {
  const last = segment.slice(-1);
  if (last === "-") return "minus";
  if (last === "+") return "plus";
  if (hasOpenQuote(accumulated)) return "open";
  return undefined;
}

/**
 * その行の機能欄が**次の行へ続いている**か。
 *
 * 書き換えの可否を決めるのに使う。**継続でつながった値は代表行だけを書き換えると壊れる**
 * ——継続行が取り残されて、閉じない引用符や宙に浮いた括弧が残る。
 */
export function startsContinuation(line: string): boolean {
  const area = functionsArea(line);
  return continuationOf(area, area) !== undefined;
}

/** 継続でまとまった機能欄。 */
export interface JoinedLine {
  /** 代表行（0 始まりの添字）。位置・長さ・用途はこの行から読む。 */
  readonly index: number;
  /** 結合後の機能欄。**継続記号は含まない。** */
  readonly keywords: string;
  /** 1 始まりの行番号。**継続に使った行を含む**（削除がまとめて消せるように）。 */
  readonly sourceLines: readonly number[];
}

/**
 * 継続でつながった行を 1 つにまとめる。**分類より先に行う。**
 *
 * ## なぜ分類より先か
 *
 * 継続元の行は引用符が閉じていないので `readConstant` が読めず、名前欄も空になる。
 * 分類を先にすると「キーワードだけの行」と判定され、**項目が丸ごと消える**
 * （直前の様式のキーワードに吸収される）。実際、実機で通る DSPF の定数 5 個のうち
 * 描かれたのは 1 個だけだった。
 *
 * ## 規則（実機で判定。2026-08-27 / IBM i 7.3）
 *
 * ローカルの原典スナップショットに継続規則のページが無いため、実機のコンパイラに判定させた
 * （`CRTDSPF` のリストの `Expanded Source` に**解決後の定数**が出る）。
 *
 * | 機能欄の最後の非空白 | 次行の取り方 | 実測 |
 * |---|---|---|
 * | `-` | `-` を捨て、**45 桁目ちょうど**から（空白も保つ） | `'ABC-` ＋ `   DEF'` → `ABC   DEF` |
 * | `+` | `+` を捨て、**最初の非空白**から | `'ABC+` ＋ `   DEF'` → `ABCDEF` |
 * | どちらでもなく引用符が開いている | **空白 1 つ**を挟んで最初の非空白から | `'ABC` ＋ `DEF'` → `ABC DEF` |
 *
 * リテラルの外でも切れ（`COLOR(-` ＋ `RED)` → `COLOR(RED)`）、3 行以上も連鎖する。
 *
 * ## 継続でない「キーワードだけの行」は対象外
 *
 * `OVERLAY` を別の行に書く形は普通で、それは**空白 1 つ**で連結する（`toLogicalUnits` の仕事）。
 * ここで継続と判定するのは、上の 3 条件に当たるときだけ。
 */
export function joinContinuations(lines: readonly string[]): JoinedLine[] {
  const joined: JoinedLine[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (isDdsCommentLine(line) || isDdsBlankLine(line)) {
      joined.push({ index, keywords: functionsArea(line), sourceLines: [index + 1] });
      index += 1;
      continue;
    }

    let segment = functionsArea(line);
    let keywords = segment;
    const sourceLines = [index + 1];
    let next = index + 1;

    for (;;) {
      const kind = continuationOf(segment, keywords);
      if (kind === undefined) break;
      // 次の行が無い / 注記行・空行なら継続しない。**継続記号はそのまま残す**
      // （捨てると「書いたのに消えた」になる）。
      if (next >= lines.length) break;
      if (isDdsCommentLine(lines[next]) || isDdsBlankLine(lines[next])) break;

      const tail = functionsArea(lines[next]);
      // **機能欄が空の行は継続に使わない。** 条件付けだけの行（次の単位への前置き）が
      // ここに来ることがあり、吸い込むとその条件が次の項目に付かなくなる。
      if (tail.length === 0) break;

      keywords =
        kind === "minus"
          ? keywords.slice(0, -1) + tail
          : kind === "plus"
            ? keywords.slice(0, -1) + tail.trimStart()
            : `${keywords} ${tail.trimStart()}`;
      sourceLines.push(next + 1);
      segment = tail;
      next += 1;
    }

    joined.push({ index, keywords, sourceLines });
    index = next;
  }

  return joined;
}

/**
 * 行の種類。**分類の規則を 1 か所に持つ**——`toLogicalUnits` と
 * `fileLevelKeywordLines` で食い違うと、同じ行が別のものとして扱われる。
 */
export type DdsLineKind = "record" | "item" | "conditioning" | "keywords" | "none";

/**
 * その行が何か。`keywords` は**継続を解いたあとの機能欄**を渡すこと
 * （継続元の行は引用符が閉じていないので、生の欄では定数と読めない）。
 */
export function classifyDdsLine(line: string, keywords: string): DdsLineKind {
  if (isDdsCommentLine(line) || isDdsBlankLine(line)) return "none";

  const nameType = ddsField(line, DDS_COLUMNS.nameType).trim().toUpperCase();
  if (nameType === "R") return "record";

  const name = ddsName(line);
  if (name.length > 0 || readConstant(keywords) !== undefined) return "item";

  // キーワード欄が空で条件付けだけ書かれている行は、次の単位への前置き。
  if (keywords.length === 0 && conditioningAreaOf(line).trim().length > 0) {
    return "conditioning";
  }
  return keywords.length > 0 ? "keywords" : "none";
}

/** ファイル・レベルのキーワード行（最初の様式・項目より前）。 */
export interface FileKeywordLine {
  /** 1 始まり。 */
  readonly sourceLine: number;
  /** その行（と継続行）の機能欄。 */
  readonly keywords: string;
  /** 条件を読むための行群（先行する条件行 → その行）。 */
  readonly conditioningLines: readonly string[];
}

/**
 * **ファイル・レベルのキーワード**を読む（`DSPSIZ` / `REF` / `INDARA` / `PRINT` など）。
 *
 * これらは**最初のレコード様式より前**に書かれる。`toLogicalUnits` は
 * レコードにも項目にも属さない先頭のキーワード行を捨てる（配置に関係しないため）ので、
 * 一覧にもプロパティにも出てこなかった。**捨てているものを別の口から読む。**
 *
 * `toLogicalUnits` の返す形を変えないのは、`resolveDspfLayout` などの読み手が
 * 「単位＝置けるもの」を前提にしているため。ここに混ぜると置こうとしてしまう。
 */
export function fileLevelKeywordLines(lines: readonly string[]): FileKeywordLine[] {
  const collected: FileKeywordLine[] = [];
  let pendingConditioning: string[] = [];

  for (const joined of joinContinuations(lines)) {
    const line = lines[joined.index];
    const kind = classifyDdsLine(line, joined.keywords);

    // 様式か項目が出たら、そこから先はファイル・レベルではない。
    if (kind === "record" || kind === "item") break;
    if (kind === "none") continue;

    if (kind === "conditioning") {
      pendingConditioning.push(line);
      continue;
    }

    collected.push({
      sourceLine: joined.index + 1,
      keywords: joined.keywords,
      conditioningLines: [...pendingConditioning, line]
    });
    pendingConditioning = [];
  }

  return collected;
}

export function toLogicalUnits(lines: readonly string[]): LogicalUnit[] {
  const units: LogicalUnit[] = [];
  /** まだ単位に属さない、先行する条件付けの行。 */
  let pendingConditioning: string[] = [];
  let pendingConditioningLines: number[] = [];

  const push = (
    kind: "record" | "item",
    line: string,
    joined: JoinedLine
  ): void => {
    units.push({
      kind,
      line,
      sourceLine: joined.index + 1,
      keywords: joined.keywords,
      conditioningLines: [...pendingConditioning, line],
      sourceLines: [...pendingConditioningLines, ...joined.sourceLines],
      // 代表行のキーワードは項目自身の条件で決まるので、群としては無条件。
      keywordGroups: [
        {
          conditioningLines: [],
          keywords: joined.keywords,
          sourceLine: joined.index + 1,
          sourceLines: [joined.index + 1]
        }
      ]
    });
    pendingConditioning = [];
    pendingConditioningLines = [];
  };

  // **継続を先に解く。** 分類より先でないと、引用符が閉じていない継続元の行が
  // 「キーワードだけの行」と誤判定され、項目が丸ごと消える。
  for (const joined of joinContinuations(lines)) {
    const line = lines[joined.index];
    if (isDdsCommentLine(line) || isDdsBlankLine(line)) continue;

    const keywordArea = joined.keywords;
    const kind = classifyDdsLine(line, keywordArea);

    if (kind === "record") {
      push("record", line, joined);
      continue;
    }

    if (kind === "item") {
      push("item", line, joined);
      continue;
    }

    // キーワード欄が空で条件付けだけ書かれている行は、**次の単位への前置き**。
    if (kind === "conditioning") {
      pendingConditioning.push(line);
      pendingConditioningLines.push(joined.index + 1);
      continue;
    }

    if (kind === "none") continue;

    // キーワードだけの行。直前の単位に**空白 1 つ**で足す。
    // **継続とは別物**（継続は上で解いてある）。`OVERLAY` を別の行に書く形がこれ。
    // 直前が無ければファイル・レベルのキーワード（REF など）で、配置に関係しない。
    const previous = units[units.length - 1];
    if (!previous) continue;

    // **この行の条件はこの行のキーワードのもの。** 先行する条件だけの行があれば
    // それも含める——原典より条件は直後の指定に付き、
    // 「最後の (または唯一の) 標識は同じ行に指定」される。
    const conditioningLines = [...pendingConditioning, line];
    const groupLines = [...pendingConditioningLines, joined.index + 1];
    pendingConditioning = [];
    pendingConditioningLines = [];

    units[units.length - 1] = {
      ...previous,
      keywords: `${previous.keywords} ${keywordArea}`.trim(),
      sourceLines: [...previous.sourceLines, ...groupLines, ...joined.sourceLines.slice(1)],
      keywordGroups: [
        ...previous.keywordGroups,
        {
          conditioningLines,
          keywords: keywordArea,
          sourceLine: joined.index + 1,
          sourceLines: groupLines
        }
      ]
    };
  }

  return units;
}
