import { DDS_COLUMNS, ddsField, ddsName } from "../ddsLayout";
import { readConditioning, type Conditioning, isMutuallyExclusive } from "./ddsConditioning";
import { constantWidth, fieldWidth, type WidthUnknownReason } from "./ddsFieldWidth";
import { readConstant, readNumber, toLogicalUnits } from "./ddsLogicalUnits";
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
  /** 画面をはみ出している。 */
  | "overflow"
  /** 位置欄に数字以外が入っている。 */
  | "invalid-position"
  /** 1 桁目に置いている（原典: 属性文字のために予約）。 */
  | "column-one-reserved"
  /** 位置欄が空で配置できない。 */
  | "missing-position"
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
const NON_DISPLAY_USAGE = new Set(["H", "P", "M"]);

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
 * 属性文字を含む実効占有を求める。**重なりの判定にだけ使う**。
 *
 * 開始属性文字は `column - 1`、終了属性文字は `column + width`。
 * 幅不明のときは終端が決められないので、データ 1 桁分として扱い、
 * 重なりの判定からは外す（誤検出を避けるため）。
 */
function occupancyOf(column: number, width: number | undefined): Occupancy {
  return {
    start: column - 1,
    end: width === undefined ? column : column + width
  };
}

/**
 * 2 つの占有が重なるか。
 *
 * **端点の一致は重なりとしない**。原典より、あるフィールドの終了属性文字は
 * 次のフィールドの開始属性文字に重ねてよく、間は 1 桁で足りる。
 */
function overlaps(a: Occupancy, b: Occupancy): boolean {
  return a.start < b.end && b.start < a.end;
}

export function resolveDspfLayout(lines: readonly string[]): DspfLayout {
  const diagnostics: DspfDiagnostic[] = [];
  const { sizes, problems } = resolveScreenSizes(lines);

  for (const problem of problems) {
    diagnostics.push({
      code: "invalid-screen-size",
      message: problem.message,
      sourceLine: problem.sourceLine
    });
  }

  const screen = sizes.primary.size;
  const items: DspfPlacedItem[] = [];
  let recordName: string | undefined;

  for (const unit of toLogicalUnits(lines)) {
    const { line, sourceLine, keywords } = unit;

    if (unit.kind === "record") {
      recordName = ddsName(line) || undefined;
      continue;
    }

    const constant = readConstant(keywords);
    const fieldName = ddsName(line);
    const isConstant = constant !== undefined && fieldName.length === 0;
    const usage = ddsField(line, DDS_COLUMNS.usage).trim().toUpperCase() || undefined;

    // 画面に出ない用途は位置を持たない。診断の対象にもしない。
    if (usage !== undefined && NON_DISPLAY_USAGE.has(usage)) continue;

    const conditioning = readConditioning(unit.conditioningLines);

    // 画面サイズ条件名が 1 次画面サイズを指していないなら、2 次画面用の位置指定。
    // 初版は 1 次だけを描くので、配置しない。**これは正当なので診断は出さない**。
    if (
      conditioning.kind === "screen-size" &&
      !matchesScreenSize(conditioning.name, sizes.primary)
    ) {
      continue;
    }

    const rowText = ddsField(line, DDS_POSITION_ROW).trim();
    const columnText = ddsField(line, DDS_POSITION_COLUMN).trim();

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

    const resolved = isConstant ? constantWidth(constant) : fieldWidth(line, keywords);
    const occupancy = occupancyOf(column, resolved.width);

    if (column <= 1) {
      diagnostics.push({
        code: "column-one-reserved",
        message:
          "1 桁目には項目を置けません" +
          "（原典: 最初の桁は属性文字のために予約されています）",
        sourceLine
      });
    }

    if (row < 1 || row > screen.rows) {
      diagnostics.push({
        code: "overflow",
        message: `行 ${row} は画面（${screen.rows} 行）の外です`,
        sourceLine
      });
    } else if (dataEnd(column, resolved.width) > screen.columns) {
      diagnostics.push({
        code: "overflow",
        message:
          `桁 ${column}${resolved.width === undefined ? "" : ` + 幅 ${resolved.width}`}` +
          `（${dataEnd(column, resolved.width)} 桁目まで）は画面（${screen.columns} 桁）の外です`,
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
      conditioning,
      occupancy
    });
  }

  diagnostics.push(...detectOverlaps(items));

  return { screen, sizes, items, diagnostics };
}

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
      if (!overlaps(a.occupancy, b.occupancy)) continue;

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
