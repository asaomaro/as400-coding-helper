import {
  DDS_COLUMNS,
  ddsField,
  ddsName,
  isDdsBlankLine,
  isDdsCommentLine
} from "../ddsLayout";
import { unconditionableKeywords, type ConditionableDdsType } from "./ddsConditionable";
import { keywordLevelDiagnostics } from "./ddsKeywordLevels";
import {
  findAlternatePosition,
  isMutuallyExclusive,
  readConditioning,
  resolveKeywordGroups,
  type Conditioning,
  type KeywordGroup
} from "./ddsConditioning";
import { constantWidth, fieldWidth, type WidthUnknownReason } from "./ddsFieldWidth";
import {
  classifyDdsLine,
  joinContinuations,
  readConstant,
  readNumber,
  toLogicalUnits,
  unitItemKind,
  type LogicalUnit
} from "./ddsLogicalUnits";
import { DDS_POSITION_COLUMN, DDS_POSITION_ROW } from "./ddsPositionColumns";
import {
  matchesScreenSize,
  resolveScreenSizes,
  type ScreenSize,
  type ScreenSizes
} from "./dspfScreenSize";

/**
 * 表示装置ファイル（DSPF）の画面レイアウトを解決する。
 *
 * このモジュールは **vscode を import しない**。DDS の行の配列を受け取り、
 * 配置済みの項目の配列を返す純粋な変換に閉じている。例外は投げない。
 *
 * ■ PRTF と違い「印刷カーソル」を持たない
 *   `SPACEB`/`SPACEA`/`SKIPB`/`SKIPA` は印刷装置ファイルのキーワードで、
 *   DSPF には無い。原典（`表示装置ファイルの位置 (39 - 44 桁目)`）:
 *   > この欄には、画面上で各フィールドが始まる**正確な位置**を指定します。
 *
 *   よって位置欄が無い項目は**流さずに配置しない**（`missing-position`）。
 *
 * ■ 属性文字が桁を消費する（DSPF 固有の核心）
 *   原典（`位置 (39 - 44 桁目)`）:
 *   > 表示される各フィールドについて、画面上でのフィールドの表示属性を
 *   > 定義するための**属性文字が 1 つ必要**です。
 *   > 画面上でのフィールドの終わりは**終了属性文字**によって示されます。
 *
 *   原典（`桁数 (30 - 34 桁目)`）:
 *   > フィールドの終了属性文字は次のフィールドの開始属性文字に**重ねることができ**、
 *   > したがって、フィールドとフィールドの間に必要なスペースは **1 文字分だけ**です。
 *   > **フィールドは、表示画面の最初の桁を占めることはできません。**
 *   > 最初の桁は属性文字のために予約されています。
 *
 *   これを数え損なうと**全項目が 1 桁ずれる**。
 */

export type DspfDiagnosticCode =
  /** 条件が同じ項目どうしが重なっている。 */
  | "overlap"
  /**
   * 利用者が指定した標識の状態で、同時に表示される項目どうしが重なっている。
   *
   * `overlap` と分けるのは**前提が違う**ため。`overlap` はソースだけから言えること
   * （両方とも無条件）で、こちらは「この標識の組み合わせなら」という前提の下でだけ成り立つ。
   * 混ぜると、指摘を消すために何を直せばよいのかが読めなくなる。
   */
  | "overlap-under-indicators"
  /** 画面をはみ出している。 */
  | "overflow"
  /** 位置欄に数字以外が入っている。 */
  | "invalid-position"
  /** 1 行 1 桁に置いている（開始属性文字を置く場所が無い）。 */
  | "column-one-reserved"
  /** 位置欄が空で配置できない。 */
  | "missing-position"
  /** 条件を付けられないキーワードに条件が付いている（実機がコンパイルしない）。 */
  | "keyword-not-conditionable"
  /**
   * キーワードを書けないレベルに書いている。**実機はコンパイルを通さない**
   * （7 通りを実機で確認）。原典がレベルを書いていないものは咎めない。
   */
  | "keyword-wrong-level"
  /** 画面サイズ条件名が 2 次画面サイズを指していない（実機がコンパイルしない）。 */
  | "invalid-screen-size-condition"
  /** 桁欄が `+n`（相対桁）。初版は解決しない。 */
  | "relative-position-unresolved"
  /** DSPSIZ の書式・値が不正。 */
  | "invalid-screen-size";

export interface DspfDiagnostic {
  readonly code: DspfDiagnosticCode;
  readonly message: string;
  /** 1 始まり。 */
  readonly sourceLine: number;
}

/** 属性文字を含む実効占有（1 始まり・両端を含む）。 */
export interface Occupancy {
  readonly start: number;
  readonly end: number;
}

export interface DspfPlacedItem {
  readonly kind: "field" | "constant";
  readonly name?: string;
  readonly text?: string;
  /** 1 始まり。 */
  readonly row: number;
  /** 1 始まり。データが始まる桁（属性文字はこの 1 つ手前）。 */
  readonly column: number;
  /** undefined は幅不明。 */
  readonly width: number | undefined;
  readonly widthUnknownReason?: WidthUnknownReason;
  readonly recordName?: string;
  /** 1 始まり。書き戻しと対応づけに使う。 */
  readonly sourceLine: number;
  /** 38 桁目。I=入力 / O=出力 / B=両方 / H=潜在 / P=プログラム間。 */
  readonly usage?: string;
  /** 35 桁目。`S`/`Y` は数値、ブランクや `A` は英数字。描画のプレースホルダに使う。 */
  readonly dataType?: string;
  /** 36-37 桁。小数点以下桁数。 */
  readonly decimals?: number;
  /**
   * 45 桁以降の生テキスト（代表行＋キーワード継続行を連結したもの）。
   *
   * **解釈しない。** キーワードの意味づけは L3 の仕事で、ここでは
   * プロパティに読み取り専用で見せるためだけに持つ。
   */
  readonly keywords: string;
  /**
   * キーワード欄を**条件ごとに**分けたもの（条件は解決済み）。
   *
   * `keywords` はこれらの連結。**見え方の解決だけ**がこちらを見る
   * ——`30 DSPATR(RI)` のように条件つきのキーワードがあると、
   * 連結だけでは「条件に関係なく効く」ことになってしまう。
   */
  readonly keywordGroups: readonly KeywordGroup[];
  readonly conditioning: Conditioning;
  readonly occupancy: Occupancy;
}

export interface DspfLayout {
  /** 描画に使う画面サイズ（＝ 1 次画面サイズ）。 */
  readonly screen: ScreenSize;
  readonly sizes: ScreenSizes;
  readonly items: readonly DspfPlacedItem[];
  readonly diagnostics: readonly DspfDiagnostic[];
}

/**
 * 画面に表示されない用途（38 桁目）。原典（`DSPSIZ`）:
 * > 潜在フィールドのみ、メッセージ・フィールドのみ、または
 * > プログラム - システム間フィールドのみが入っているレコード（は位置を占めない）
 *
 * 原典（`位置 (39 - 44 桁目)`）:
 * > 潜在フィールド、プログラム - システム間フィールド、または
 * > メッセージ・フィールドについては、**位置を指定することはできません**。
 */
export const NON_DISPLAY_USAGE: ReadonlySet<string> = new Set(["H", "P", "M"]);

/** 桁欄が `+n` / `-n`（DDS の「プラス機能」＝相対桁）か。 */
function isRelativePosition(text: string): boolean {
  return /^[+-]\s*\d+$/u.test(text.trim());
}

/**
 * データが最後に載る桁。**はみ出しの判定はこれで行う**。
 *
 * 終了属性文字（`occupancy.end`）で判定してはいけない。原典（`桁数 (30 - 34 桁目)`）:
 * > 文字フィールドの最大桁数は、表示画面サイズから 1 を引いた桁数です
 * > （この 1 桁は**開始**属性文字のためのスペースです）。
 *
 * 80 桁画面なら 2 桁目・幅 79 が最大で、データは 80 桁目まで届く。
 * このとき終了属性文字の置き場所は無いが、原典はこれを最大値として認めている。
 * `occupancy.end` で判定すると、**原典が認める最大幅を誤検出**する。
 */
function dataEnd(column: number, width: number | undefined): number {
  return width === undefined ? column : column + width - 1;
}

/**
 * 符号のために余分に占有する桁数。
 *
 * **入力できる用途（`B` / `I`）の数字フィールドは、画面上で 1 桁多く占める。**
 * `S`（符号付き数字）は**符号**の場所、`Y`（数字のみ）で小数点以下があれば
 * **小数点**の場所が要るため。表示専用（`O`）では増えない。
 *
 * 原典（`表示装置ファイルの桁数 (30 - 34 桁目)`）は増えること自体は述べている:
 * > 画面に表示されるときのフィールドの桁数を**表示桁数**といいます。表示桁数は、
 * > プログラム桁数と同じかまたは**それより大きくなります**。フィールドの表示桁数は、
 * > **キーボード・シフト (35 桁目に指定)** のほか、**小数点以下の桁数 (36 および 37 桁目)**
 * > や**編集機能**などのその他のフィールド仕様によって決まります。
 *
 * ただし**どれだけ増えるかの表は原典のこのページに無い**（「有効な項目」の子ページ）。
 * AGENTS.md「原典と実機が食い違ったら、実機のパーサーに判定させる」に従い、
 * **全通りを実機に出して 5250 が返す欄の桁数を読んだ**
 * （`.aidev/works/20260827-dds-render-golden/verify/probe-display-length.mjs`。
 * 2026-08-27 / IBM i 7.3。桁数 6 で宣言して測った値）:
 *
 * | 35 桁 | 小数 | 使用 | 実機 | 増える桁 |
 * |---|---|---|---|---|
 * | `A` / `X` / `N` | – | `I` / `B` | 6 | 0 |
 * | `S` | 0 | `I` / `B` | 7 | **+1**（符号） |
 * | `S` | 2 | `I` / `B` | 7 | **+1**（符号のみ。小数点は出ない） |
 * | `S` | 0 / 2 | `O` | 6 | 0 |
 * | `Y` | 0 | `I` / `B` / `O` | 6 | 0 |
 * | **`Y`** | **2** | **`I` / `B`** | **7** | **+1（小数点）** |
 * | `Y` | 2 | `O` | 6 | 0 |
 *
 * **`Y` × 小数点ありの行は取りこぼしていた**（`20260827-dds-render-golden` で発覚）。
 * 数字の入力欄はどの画面にもあるので、重なり・はみ出しの判定が 1 桁甘かった。
 *
 * ■ 編集（`EDTCDE`）があるときは足さない
 *   `fieldWidth` が `editedWidth` で解いた幅に**小数点も符号も既に入っている**。
 *   実機でも `6Y 2B EDTCDE(J)` は 9 桁で、`editedWidth` の返す 9 と一致する。
 *   ここで足すと二重になる。
 *
 * **画面には空白として出る**ので、描く幅（`width`）には含めない。
 * 含めると存在しない文字を描くことになる。占有（重なり）とはみ出しの判定にだけ効かせる。
 */
/** `EDTCDE` が書かれているか。幅の解決（`fieldWidth`）と同じ形で見る。 */
const HAS_EDIT_CODE = /\bEDTCDE\s*\(/u;

function extraDisplayPositions(
  dataType: string | undefined,
  usage: string | undefined,
  decimals: number | undefined,
  hasEditCode: boolean
): number {
  // 編集が効いている幅には小数点も符号も入っている（`editedWidth`）。二重に足さない。
  if (hasEditCode) return 0;

  const use = (usage ?? "").trim().toUpperCase();
  // 表示専用は入力しないので、符号にも小数点にも場所が要らない。
  if (use !== "B" && use !== "I") return 0;

  const type = (dataType ?? "").trim().toUpperCase();
  if (type === "S") return 1;
  if (type === "Y" && (decimals ?? 0) > 0) return 1;
  return 0;
}

/**
 * 属性文字を含む実効占有を求める。**重なりの判定にだけ使う**。
 *
 * 開始属性文字は `column - 1`、終了属性文字は `column + width`。
 * 幅不明のときは終端が決められないので、データ 1 桁分として扱い、
 * 重なりの判定からは外す（誤検出を避けるため）。
 */
function occupancyOf(
  column: number,
  width: number | undefined,
  signWidth = 0
): Occupancy {
  return {
    start: column - 1,
    end: width === undefined ? column : column + width + signWidth
  };
}

/**
 * 2 つの占有が重なるか。
 *
 * **端点の一致は重なりとしない**。原典より、あるフィールドの終了属性文字は
 * 次のフィールドの開始属性文字に重ねてよく、間は 1 桁で足りる。
 */
export function occupanciesOverlap(a: Occupancy, b: Occupancy): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * どちらの画面サイズで解決するか。
 *
 * **2 次画面サイズは、位置の上書き行で描く。** 原典（`DSPSIZ` の 例 2 / 例 3）より、
 * 2 つのサイズを持つファイルでは同じ項目をサイズごとに別の位置へ置ける。
 * 上書きが無い項目は 1 次と同じ位置に出る。
 */
export interface DspfLayoutOptions {
  readonly screenSize?: "primary" | "secondary";
}

export function resolveDspfLayout(
  lines: readonly string[],
  options: DspfLayoutOptions = {}
): DspfLayout {
  const diagnostics: DspfDiagnostic[] = [];
  const { sizes, problems } = resolveScreenSizes(lines);
  // 2 次が無ければ 1 次で解く（呼び出し側が知らずに指定しても壊れない）。
  const target =
    options.screenSize === "secondary" && sizes.secondary !== undefined
      ? sizes.secondary
      : sizes.primary;

  for (const problem of problems) {
    diagnostics.push({
      code: "invalid-screen-size",
      message: problem.message,
      sourceLine: problem.sourceLine
    });
  }

  const screen = target.size;
  const items: DspfPlacedItem[] = [];
  let recordName: string | undefined;

  const units = toLogicalUnits(lines);
  diagnostics.push(...unconditionableDiagnostics(units, "DSPF"));
  diagnostics.push(...keywordLevelDiagnostics(lines, units, "DSPF"));
  diagnostics.push(...undeclaredScreenSizeDiagnostics(lines, sizes));

  for (const unit of units) {
    const { line, sourceLine, keywords } = unit;

    if (unit.kind === "record") {
      recordName = ddsName(line) || undefined;
      continue;
    }

    const constant = readConstant(keywords);
    const fieldName = ddsName(line);
    // 種別の判定は `ddsLogicalUnits` に一本化してある（編集側と同じ規則を使う）。
    const isConstant = unitItemKind(unit) === "constant";
    const usage = ddsField(line, DDS_COLUMNS.usage).trim().toUpperCase() || undefined;

    // 画面に出ない用途は位置を持たない。診断の対象にもしない。
    if (usage !== undefined && NON_DISPLAY_USAGE.has(usage)) continue;

    const conditioning = readConditioning(unit.conditioningLines);

    // 画面サイズ条件名が対象のサイズを指していないなら、別のサイズ用の指定。
    // **これは正当なので診断は出さない**（使えない条件名かどうかは別に見ている）。
    if (
      conditioning.kind === "screen-size" &&
      !matchesScreenSize(conditioning.name, target)
    ) {
      continue;
    }

    // **対象のサイズを指す上書き行があれば、その位置で描く。**
    // 原典（`DSPSIZ` の 例 2）: 同じ項目をサイズごとに別の位置へ置ける。
    const override = findAlternatePosition(unit, target);
    const positionLine = override?.line ?? line;

    const rowText = ddsField(positionLine, DDS_POSITION_ROW).trim();
    const columnText = ddsField(positionLine, DDS_POSITION_COLUMN).trim();

    // DDS の「プラス機能」（相対桁）。原典が折り返し規則を明示していないため、
    // 推測で描かずに未解決として示す。
    if (isRelativePosition(columnText)) {
      diagnostics.push({
        code: "relative-position-unresolved",
        message:
          `相対桁 "${columnText}" は解決しません` +
          "（原典に折り返し規則の明示が無いため、この項目は描画しません）",
        sourceLine
      });
      continue;
    }

    const row = readNumber(rowText);
    const column = readNumber(columnText);

    const invalid = [
      rowText.length > 0 && row === undefined ? `行 "${rowText}"` : "",
      columnText.length > 0 && column === undefined ? `桁 "${columnText}"` : ""
    ].filter(text => text.length > 0);

    if (invalid.length > 0) {
      diagnostics.push({
        code: "invalid-position",
        message: `位置欄が数字ではありません（${invalid.join(" / ")}）`,
        sourceLine
      });
      continue;
    }

    // DSPF は位置が無ければ配置できない（PRTF のように前の行から流さない）。
    if (row === undefined || column === undefined) {
      diagnostics.push({
        code: "missing-position",
        message:
          "位置欄（39-44 桁）が指定されていません" +
          "（原典: 画面上で各フィールドが始まる正確な位置を指定します）",
        sourceLine
      });
      continue;
    }

    const resolved = isConstant
      ? constantWidth(constant ?? "")
      : fieldWidth(line, keywords, "DSPF");
    const dataType = ddsField(line, DDS_COLUMNS.dataType).trim().toUpperCase() || undefined;
    const decimals = readNumber(ddsField(line, DDS_COLUMNS.decimals));
    const sign = isConstant
      ? 0
      : extraDisplayPositions(dataType, usage, decimals, HAS_EDIT_CODE.test(keywords));
    const occupancy = occupancyOf(column, resolved.width, sign);

    if (isRowOneColumnOne(row, column)) {
      diagnostics.push({
        code: "column-one-reserved",
        message: COLUMN_ONE_MESSAGE,
        sourceLine
      });
    }

    if (row < 1 || row > screen.rows) {
      diagnostics.push({
        code: "overflow",
        message: `行 ${row} は画面（${screen.rows} 行）の外です`,
        sourceLine
      });
    } else if (dataEnd(column, resolved.width) + sign > screen.columns) {
      diagnostics.push({
        code: "overflow",
        message:
          `桁 ${column}${resolved.width === undefined ? "" : ` + 幅 ${resolved.width}`}` +
          `（${dataEnd(column, resolved.width) + sign} 桁目まで）は画面（${screen.columns} 桁）の外です`,
        sourceLine
      });
    }

    items.push({
      kind: isConstant ? "constant" : "field",
      name: isConstant ? undefined : fieldName || undefined,
      text: isConstant ? constant : undefined,
      row,
      column,
      width: resolved.width,
      widthUnknownReason: resolved.reason,
      recordName,
      sourceLine,
      usage,
      ...(dataType !== undefined ? { dataType } : {}),
      ...(decimals !== undefined
        ? { decimals }
        : {}),
      keywords,
      keywordGroups: resolveKeywordGroups(unit),
      conditioning,
      occupancy
    });
  }

  diagnostics.push(...detectOverlaps(items));

  return { screen, sizes, items, diagnostics };
}


/**
 * **画面サイズ条件名が 2 次画面サイズを指していない**行を報告する。
 *
 * ## 規則は実機が決めた
 *
 * 「`DSPSIZ` に宣言してあればよい」と思っていたが、違った。実機で確かめた
 * （2026-08-28 / IBM i 7.3。`.aidev/works/20260828-dds-undeclared-screen-size/verify/`）:
 *
 * | `DSPSIZ` | 条件名 | `CRTDSPF` |
 * |---|---|---|
 * | 無し | `*DS3` / `*DS4` | 通らない |
 * | `(24 80)` | `*DS3` / `*DS4` | 通らない |
 * | `(24 80 27 132)` | `*DS3`（**1 次**） | **通らない** |
 * | `(24 80 27 132)` | `*DS4`（2 次） | 通る |
 * | `(27 132 *WIDE 24 80 *NORMAL)` | `*WIDE`（**1 次**） | **通らない** |
 * | 同上 | `*NORMAL`（2 次） | 通る |
 * | 同上 | `*NOTDEC`（未宣言） | 通らない |
 *
 * **7 通りすべてを 1 つの規則が説明する**——条件名は**2 次画面サイズ**を指していなければ
 * ならない。理屈も通る: 項目自身の行が 1 次の位置を与えるので、
 * 1 次を条件にした指定は矛盾する。
 *
 * ## もう 1 つの規則: **位置の上書き行にしか書けない**
 *
 * 実機で書ける形を洗った（同上）:
 *
 * | 条件名を書く行 | `CRTDSPF` |
 * |---|---|
 * | **位置の上書き行**（条件名 ＋ 位置だけ） | **通る** |
 * | 定数の行（独立した項目） | 通らない |
 * | 項目自身の行（名前つき） | 通らない |
 * | 様式の行 | 通らない |
 * | キーワード行（`DSPATR` / `COLOR` / `OVERLAY` の 3 つで確認） | 通らない |
 *
 * **原典と食い違う。** 原典（`条件付け (7 - 16 桁目)`）は
 * > DSPSIZ キーワードに指定した画面サイズ条件名によって、**キーワードの使用や**
 * > フィールドの位置を条件付けることができます。
 *
 * と書くが、実機はキーワードの条件付けを通さなかった（3 つのキーワードで確認）。
 * AGENTS.md「原典と実機が食い違ったら、実機のパーサーに判定させる」に従い実機を採る。
 *
 * ## 判定
 *
 * 2 次画面サイズが宣言されていて、かつ `matchesScreenSize` がそれに一致すること。
 * IBM 提供名（`*DS3` / `*DS4`）もサイズに解決してから突き合わせる（原典）。
 */
function undeclaredScreenSizeDiagnostics(
  lines: readonly string[],
  sizes: ScreenSizes
): DspfDiagnostic[] {
  const diagnostics: DspfDiagnostic[] = [];

  const check = (line: string, keywords: string, sourceLine: number): void => {
    const conditioning = readConditioning([line]);
    if (conditioning.kind !== "screen-size") return;
    const { name } = conditioning;

    // ■ 規則 1: **位置の上書き行にしか書けない**（条件名 ＋ 位置だけの行）。
    if (classifyDdsLine(line, keywords) !== "position-override") {
      diagnostics.push({
        code: "invalid-screen-size-condition",
        message:
          `画面サイズ条件名 ${name} は位置の上書き行にしか書けません` +
          "（条件名と位置だけの行。項目・様式・キーワードの行には書けません）。" +
          "実機はこの形をコンパイルしません",
        sourceLine
      });
      return;
    }

    // ■ 規則 2: **2 次画面サイズを指していること**。
    if (sizes.secondary !== undefined && matchesScreenSize(name, sizes.secondary)) {
      return;
    }

    const why =
      sizes.secondary === undefined
        ? "2 次画面サイズが DSPSIZ に宣言されていません"
        : matchesScreenSize(name, sizes.primary)
          ? "1 次画面サイズを指しています（項目の行が 1 次の位置を与えるので指定が矛盾します）"
          : "DSPSIZ に宣言されていません";

    diagnostics.push({
      code: "invalid-screen-size-condition",
      message:
        `画面サイズ条件名 ${name} では条件付けできません——${why}。` +
        "条件名は 2 次画面サイズを指す必要があります（実機はこの形をコンパイルしません）",
      sourceLine
    });
  };

  // **論理単位を通さない。** 上書き行は直前が項目のときだけ単位に付き、
  // 様式の直後などでは付く先が無い（`collectIndicators` と同じ理由で生の行を見る）。
  // 継続は解いてから分類する（解かないと継続元の行を項目と読み違える）。
  for (const joined of joinContinuations(lines)) {
    const line = lines[joined.index];
    if (isDdsCommentLine(line) || isDdsBlankLine(line)) continue;
    check(line, joined.keywords, joined.index + 1);
  }

  return diagnostics;
}

/**
 * **条件を付けられないキーワードに条件が付いている**行を報告する。
 *
 * DDS は条件が付く対象を「フィールドまたはキーワード」とするが、
 * **キーワードごとに可否が決まっている**。付けられないものに付けると実機は
 * コンパイルを通さない（`CPF7311`。`EDTCDE` / `EDTWRD` / `CHECK` で確認済み）。
 * デザイナが黙っていると、壊れたと気付くのは実機に持っていったときになる。
 *
 * 可否が原典に書かれていないキーワードは**黙って通す**（知らないものを咎めない）。
 */
function unconditionableDiagnostics(
  units: readonly LogicalUnit[],
  ddsType: ConditionableDdsType
): { code: "keyword-not-conditionable"; message: string; sourceLine: number }[] {
  const diagnostics: {
    code: "keyword-not-conditionable";
    message: string;
    sourceLine: number;
  }[] = [];

  for (const unit of units) {
    // **先頭の群は代表行**。そこに書かれたキーワードは項目自身の条件で決まるので、
    // 「キーワードに条件を付けた」ことにはならない。
    for (const group of resolveKeywordGroups(unit).slice(1)) {
      if (group.conditioning.kind !== "indicators") continue;
      const names = unconditionableKeywords(ddsType, group.keywords);
      if (names.length === 0) continue;
      diagnostics.push({
        code: "keyword-not-conditionable",
        message:
          `${names.join(" / ")} には条件標識を付けられません` +
          "（原典: オプション標識は、このキーワードでは無効です）。" +
          "実機はこの形をコンパイルしません",
        sourceLine: group.sourceLine
      });
    }
  }

  return diagnostics;
}

/**
 * **1 行 1 桁だけが置けない。** 他の行の 1 桁目は置ける。
 *
 * 原典（`表示装置ファイルの桁数 (30 - 34 桁目)`）は
 * > フィールドは、表示画面の最初の桁を占めることはできません。
 * > 最初の桁は属性文字のために予約されています。例えば 24 x 80 の画面で、
 * > 符号付き数字フィールドについて、**39 - 41 桁目 (行) に 1 を指定し、
 * > 42 - 44 桁目 (桁) に 1 を指定した**とすると、フィールドは 1 行目の 1 桁目から
 * > 始まってしまうことになり、したがってこの指定は無効です。
 *
 * と書く。読みようによっては「どの行でも 1 桁目は不可」だが、**原典の例は 1 行 1 桁**で、
 * 実機で確かめると**そのとおり**だった（2026-08-27 / IBM i 7.3）:
 *
 * | 位置 | `CRTDSPF` |
 * |---|---|
 * | **1 行 1 桁**（定数・フィールドとも） | **通らない**（`CPF7311`） |
 * | 2 行 1 桁 | 通る |
 * | 1 行 2 桁 | 通る |
 *
 * 開始属性文字は 1 桁手前——**2 行 1 桁なら 1 行 80 桁**に置けるが、
 * 1 行 1 桁には手前が無い。以前は行を見ずに `column <= 1` で報告しており、
 * **既定 ON の規則が実機で通るソースを誤検出していた**
 * （`20260827-dds-edit-type-aware` で実機に判定させて判明）。
 */
export function isRowOneColumnOne(row: number, column: number): boolean {
  return row === 1 && column === 1;
}

/** 1 行 1 桁の説明。診断と編集の拒否で**同じ文**を使う。 */
export const COLUMN_ONE_MESSAGE =
  "1 行 1 桁には項目を置けません（開始属性文字を置く手前の桁がありません）。" +
  "他の行の 1 桁目は置けます（属性文字は前の行の 80 桁目に入ります）";

/**
 * 重なりの検出。
 *
 * ■ 同じレコード様式の中だけを見る
 *   レコード様式は排他的に表示されるので、様式をまたぐ重なりは正当。
 *
 * ■ 条件が違えば重なりではない
 *   原典（`位置 (39 - 44 桁目)`）:
 *   > 1 つのレコード様式内で、フィールドを他のフィールドまたは属性文字と
 *   > オーバーラップするように定義することができます。ただし、このように
 *   > 相互にオーバーラップするフィールドのうち、**一時点で画面に表示されるのは 1 つだけ**です。
 *
 * ■ 幅不明の項目は対象にしない
 *   終端が決められないので、重なっているかを判断できない。
 */
function detectOverlaps(items: readonly DspfPlacedItem[]): DspfDiagnostic[] {
  const diagnostics: DspfDiagnostic[] = [];

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      if (a.row !== b.row) continue;
      if (a.recordName !== b.recordName) continue;
      if (a.width === undefined || b.width === undefined) continue;
      if (isMutuallyExclusive(a.conditioning, b.conditioning)) continue;
      if (!occupanciesOverlap(a.occupancy, b.occupancy)) continue;

      diagnostics.push({
        code: "overlap",
        message:
          `${describe(a)} と ${describe(b)} が ${a.row} 行目で重なっています` +
          "（属性文字を含む占有で判定）",
        sourceLine: b.sourceLine
      });
    }
  }

  return diagnostics;
}

function describe(item: DspfPlacedItem): string {
  if (item.kind === "constant") return `定数 '${item.text ?? ""}'`;
  return item.name ?? "名前のない項目";
}
