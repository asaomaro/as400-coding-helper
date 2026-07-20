import {
  DDS_COLUMNS,
  ddsField,
  ddsName,
  isDdsBlankLine,
  isDdsCommentLine
} from "../ddsLayout";
import { printWidth } from "../dbcs";
import { PRTF_POSITION_COLUMN, PRTF_POSITION_ROW } from "./prtfColumns";
import { editedWidth } from "./editCode";

/**
 * 印刷装置ファイル（PRTF）の紙面レイアウトを解決する。
 *
 * このモジュールは **vscode を import しない**。DDS の行の配列を受け取り、
 * 配置済みの項目の配列を返す純粋な変換に閉じている。
 *
 * ■ 行は位置欄だけでは決まらない
 *   原典（`位置 (39 から 44 桁目)`）:
 *   > 行番号を使用しない場合には、印刷装置ファイル内で必要なフィールド順序の
 *   > とおりに、DDS でフィールドを指定しなければなりません。
 *
 *   `SPACEB`/`SPACEA`（相対）と `SKIPB`/`SKIPA`（絶対）が「現在の印刷行」を
 *   動かすので、**ファイルを頭から走査する状態計算**になる。
 *   RPG 仕様書の種別判定（`core/rpgSpec.ts` の RpgSpecContext）と同じ形。
 *
 * ■ レベルで効き方が違う（decisions.md D1・原典で確定）
 *   レコード・レベル … レコードの**すべての行**の前後
 *   フィールド・レベル … **その項目**の前後
 */

export type WidthUnknownReason =
  | "reference"
  | "user-defined-edit-code"
  | "not-numeric"
  | "no-length";

export interface PlacedItem {
  readonly kind: "field" | "constant";
  readonly name?: string;
  readonly text?: string;
  /** 1 始まり。 */
  readonly row: number;
  /** 1 始まり。 */
  readonly column: number;
  /** undefined は幅不明。 */
  readonly width: number | undefined;
  readonly widthUnknownReason?: WidthUnknownReason;
  readonly recordName?: string;
  /** 1 始まり。書き戻しと対応づけに使う。 */
  readonly sourceLine: number;
  /** 位置欄に行番号が書かれていたか（書き戻しの確認に使う）。 */
  readonly hasExplicitRow: boolean;
}

export type LayoutDiagnosticCode =
  /** 行番号のあるレコードで SPACE / SKIP 系を使っている（原典: 無効）。 */
  | "spacing-with-line-number"
  /** SPACE / SKIP 系を無効にするキーワードと併用している。 */
  | "spacing-with-conflicting-keyword"
  /** 行番号もスキップもスペースも無い（原典: 2 重印刷になり得る）。 */
  | "possible-overprint"
  /** 項目が重なっている（原典: 警告＋2 重印刷）。 */
  | "overlap"
  /** 紙面をはみ出している。 */
  | "overflow"
  /** 行・桁が原典の上限（255）を超えている。 */
  | "out-of-range"
  /** 位置欄に数字以外が入っている（桁が読めない）。 */
  | "invalid-position";

export interface LayoutDiagnostic {
  readonly code: LayoutDiagnosticCode;
  readonly message: string;
  /** 1 始まり。 */
  readonly sourceLine: number;
}

export interface PrtfPage {
  readonly rows: number;
  readonly columns: number;
  /** オーバーフロー行。既定は CRTPRTF の OVRFLW 既定値。 */
  readonly overflowLine: number;
}

export interface PrtfLayout {
  readonly page: PrtfPage;
  readonly items: readonly PlacedItem[];
  readonly diagnostics: readonly LayoutDiagnostic[];
}

export interface PrtfLayoutOptions {
  readonly page?: Partial<PrtfPage>;
}

/** CRTPRTF の PAGESIZE / OVRFLW の既定値（原典由来。PJ の CL 定義から）。 */
export const DEFAULT_PAGE: PrtfPage = {
  rows: 66,
  columns: 132,
  overflowLine: 60
};

/** 原典: 指定できる行番号・桁番号の最大値は 255。 */
const MAX_POSITION = 255;

/**
 * SPACE / SKIP 系を無効にするレコード様式のキーワード（原典）。
 * > SPACEA キーワードは、レコード様式に BOX、ENDPAGE、GDF、LINE、OVERLAY、
 * > PAGSEG、または POSITION キーワードも指定されている場合には…無効です。
 */
const SPACING_CONFLICTS = [
  "BOX",
  "ENDPAGE",
  "GDF",
  "LINE",
  "OVERLAY",
  "PAGSEG",
  "POSITION"
];

interface Spacing {
  readonly skipBefore?: number;
  readonly spaceBefore?: number;
  readonly skipAfter?: number;
  readonly spaceAfter?: number;
  readonly hasAny: boolean;
  readonly conflicting: readonly string[];
}

/** キーワード欄（45 桁以降）から数値パラメータのキーワードを読む。 */
function readSpacing(keywords: string): Spacing {
  const value = (name: string): number | undefined => {
    const match = new RegExp(`\\b${name}\\s*\\(\\s*(\\d+)\\s*\\)`, "u").exec(keywords);
    return match ? Number(match[1]) : undefined;
  };

  const skipBefore = value("SKIPB");
  const spaceBefore = value("SPACEB");
  const skipAfter = value("SKIPA");
  const spaceAfter = value("SPACEA");

  return {
    skipBefore,
    spaceBefore,
    skipAfter,
    spaceAfter,
    hasAny:
      skipBefore !== undefined ||
      spaceBefore !== undefined ||
      skipAfter !== undefined ||
      spaceAfter !== undefined,
    conflicting: SPACING_CONFLICTS.filter(name =>
      new RegExp(`\\b${name}\\b`, "u").test(keywords)
    )
  };
}

/** 定数（キーワード欄の `'…'`）を取り出す。 */
function readConstant(keywords: string): string | undefined {
  const match = /^'((?:[^']|'')*)'/u.exec(keywords.trim());
  return match ? match[1].replace(/''/gu, "'") : undefined;
}

function readNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  if (!/^\d+$/u.test(trimmed)) return undefined;
  return Number(trimmed);
}

interface Cursor {
  row: number;
  recordName?: string;
  /** 現在のレコードで桁送りキーワードを見たか（レコード・項目のどちらでも）。 */
  recordHasSpacing?: boolean;
  /** 現在のレコードの項目のうち、行番号を持たないものの行番号（診断用）。 */
  recordItemsWithoutRow?: number[];
  /** レコード・レベルの後置き（レコードの全行の後に効く）。 */
  pendingRecordAfter?: { skipAfter?: number; spaceAfter?: number };
}

function applyBefore(cursor: Cursor, spacing: Spacing): void {
  if (spacing.skipBefore !== undefined) cursor.row = spacing.skipBefore;
  if (spacing.spaceBefore !== undefined) cursor.row += spacing.spaceBefore;
}

function applyAfter(cursor: Cursor, spacing: Spacing): void {
  if (spacing.skipAfter !== undefined) cursor.row = spacing.skipAfter;
  if (spacing.spaceAfter !== undefined) cursor.row += spacing.spaceAfter;
}

function flushRecordAfter(cursor: Cursor): void {
  const pending = cursor.pendingRecordAfter;
  if (!pending) return;
  if (pending.skipAfter !== undefined) cursor.row = pending.skipAfter;
  if (pending.spaceAfter !== undefined) cursor.row += pending.spaceAfter;
  cursor.pendingRecordAfter = undefined;
}

/**
 * 論理単位。DDS では**キーワードだけの行は直前のレコード／項目の続き**なので、
 * 行を 1 本ずつ処理すると桁送りの持ち主を取り違える。
 *
 * 実際に `CUSTRPT.prtf` で踏んだ:
 * ```
 *   A          R HEADING                   SKIPB(1)
 *   A                                      SPACEA(2)   ← HEADING のキーワード
 *   A                                    30'顧客一覧表'
 * ```
 * 2 行目を独立した行として扱うと、見出しと明細が同じ行に重なる。
 */
interface LogicalUnit {
  readonly kind: "record" | "item";
  /** 単位の代表行（項目の桁を読む行）。 */
  readonly line: string;
  readonly sourceLine: number;
  /** 代表行＋継続行のキーワード欄を連結したもの。 */
  readonly keywords: string;
}

function toLogicalUnits(lines: readonly string[]): LogicalUnit[] {
  const units: LogicalUnit[] = [];
  const keywordAreaOf = (line: string): string => line.slice(44).trimEnd();

  lines.forEach((line, index) => {
    if (isDdsCommentLine(line) || isDdsBlankLine(line)) return;

    const nameType = ddsField(line, DDS_COLUMNS.nameType).trim().toUpperCase();
    const name = ddsName(line);
    const keywordArea = keywordAreaOf(line);
    const constant = readConstant(keywordArea);

    if (nameType === "R") {
      units.push({
        kind: "record",
        line,
        sourceLine: index + 1,
        keywords: keywordArea
      });
      return;
    }

    if (name.length > 0 || constant !== undefined) {
      units.push({
        kind: "item",
        line,
        sourceLine: index + 1,
        keywords: keywordArea
      });
      return;
    }

    // キーワードだけの行。直前の単位に足す。
    // 直前が無ければファイル・レベルのキーワード（REF など）で、配置に関係しない。
    const previous = units[units.length - 1];
    if (!previous) return;
    units[units.length - 1] = {
      ...previous,
      keywords: `${previous.keywords} ${keywordArea}`.trim()
    };
  });

  return units;
}

export function resolvePrtfLayout(
  lines: readonly string[],
  options?: PrtfLayoutOptions
): PrtfLayout {
  const page: PrtfPage = { ...DEFAULT_PAGE, ...(options?.page ?? {}) };
  const items: PlacedItem[] = [];
  const diagnostics: LayoutDiagnostic[] = [];
  const cursor: Cursor = { row: 1 };

  for (const unit of toLogicalUnits(lines)) {
    const { line, sourceLine, keywords } = unit;
    const spacing = readSpacing(keywords);
    const explicitRow = readNumber(ddsField(line, PRTF_POSITION_ROW));
    const explicitColumn = readNumber(ddsField(line, PRTF_POSITION_COLUMN));

    // --- レコード様式 ---
    if (unit.kind === "record") {
      flushRecordAfter(cursor);
      diagnostics.push(...detectOverprint(cursor));
      cursor.recordName = ddsName(line) || undefined;
      cursor.recordHasSpacing = spacing.hasAny;
      cursor.recordItemsWithoutRow = [];
      applyBefore(cursor, spacing);
      // レコード・レベルの後置きは「レコードのすべての行の後」に効く（D1）。
      cursor.pendingRecordAfter = {
        skipAfter: spacing.skipAfter,
        spaceAfter: spacing.spaceAfter
      };
      if (spacing.conflicting.length > 0 && spacing.hasAny) {
        diagnostics.push({
          code: "spacing-with-conflicting-keyword",
          message:
            `${spacing.conflicting.join(" / ")} と SPACE/SKIP は併用できません` +
            "（原典: この場合 SPACE/SKIP は無効）",
          sourceLine
        });
      }
      continue;
    }

    // --- 項目（フィールド or 定数）---
    const constant = readConstant(keywords);
    const fieldName = ddsName(line);
    const isConstant = constant !== undefined && fieldName.length === 0;

    if (spacing.hasAny && explicitRow !== undefined) {
      diagnostics.push({
        code: "spacing-with-line-number",
        message:
          "行番号（39-41 桁）のある項目で SPACE/SKIP は無効です" +
          "（原典: 行番号にエラーを示すフラグが付けられます）",
        sourceLine
      });
    }

    // 位置欄に数字以外が入っていたら、黙って 1 行 1 桁に置かない。
    // 「書けていないものが正しく置かれたように見える」のが一番まずい。
    const rowText = ddsField(line, PRTF_POSITION_ROW).trim();
    const columnText = ddsField(line, PRTF_POSITION_COLUMN).trim();
    const invalid = [
      rowText.length > 0 && explicitRow === undefined ? `行 "${rowText}"` : "",
      columnText.length > 0 && explicitColumn === undefined
        ? `桁 "${columnText}"`
        : ""
    ].filter(text => text.length > 0);

    if (invalid.length > 0) {
      diagnostics.push({
        code: "invalid-position",
        message: `位置欄が数字ではありません（${invalid.join(" / ")}）`,
        sourceLine
      });
      // 配置できないので項目として積まない（描画しない）。
      continue;
    }

    applyBefore(cursor, spacing);

    const row = explicitRow ?? cursor.row;
    const column = explicitColumn ?? 1;

    let width: number | undefined;
    let widthUnknownReason: WidthUnknownReason | undefined;

    if (isConstant) {
      width = printWidth(constant);
    } else if (ddsField(line, DDS_COLUMNS.reference).trim().toUpperCase() === "R") {
      widthUnknownReason = "reference";
    } else {
      const length = readNumber(ddsField(line, DDS_COLUMNS.length));
      if (length === undefined) {
        widthUnknownReason = "no-length";
      } else {
        const editMatch = /\bEDTCDE\s*\(\s*([0-9A-Za-z])\s*([^)]*)\)/u.exec(keywords);
        if (editMatch) {
          const decimals = readNumber(ddsField(line, DDS_COLUMNS.decimals)) ?? 0;
          const dataType = ddsField(line, DDS_COLUMNS.dataType);
          const edited = editedWidth(length, decimals, editMatch[1], editMatch[2], dataType);
          if (edited.kind === "width") {
            width = edited.width;
          } else {
            widthUnknownReason =
              edited.reason === "user-defined"
                ? "user-defined-edit-code"
                : edited.reason === "not-numeric"
                  ? "not-numeric"
                  : "no-length";
          }
        } else {
          width = length;
        }
      }
    }

    if (row > MAX_POSITION || column > MAX_POSITION) {
      diagnostics.push({
        code: "out-of-range",
        message: `行・桁の上限は ${MAX_POSITION} です（行 ${row} / 桁 ${column}）`,
        sourceLine
      });
    }

    items.push({
      kind: isConstant ? "constant" : "field",
      ...(isConstant ? { text: constant } : { name: fieldName }),
      row,
      column,
      width,
      ...(widthUnknownReason ? { widthUnknownReason } : {}),
      ...(cursor.recordName ? { recordName: cursor.recordName } : {}),
      sourceLine,
      hasExplicitRow: explicitRow !== undefined
    });

    if (spacing.hasAny) cursor.recordHasSpacing = true;
    if (explicitRow === undefined) {
      (cursor.recordItemsWithoutRow ??= []).push(sourceLine);
    }

    applyAfter(cursor, spacing);
  }

  flushRecordAfter(cursor);
  diagnostics.push(...detectOverprint(cursor));

  diagnostics.push(...detectOverlaps(items), ...detectOverflow(items, page));
  diagnostics.sort((a, b) => a.sourceLine - b.sourceLine);

  return { page, items, diagnostics };
}

/**
 * 2 重印刷の検出。原典（`SPACEA` キーワード）の注記:
 * > 注: 行番号を使用せず、スキップ・キーワードもスペース・キーワードも
 * > 指定しなかった場合には、**2 重印刷 (重ね打ち) が行われることがあります。**
 *
 * `overlap` は症状で、こちらが原因。「桁送りを書いていないから重なっている」
 * ことを示すために別に持つ（decisions.md D3）。
 *
 * **エラーにはしない**。原典も「行われることがあります」で、意図的な重ね打ちも
 * あり得る。
 */
function detectOverprint(cursor: Cursor): LayoutDiagnostic[] {
  const withoutRow = cursor.recordItemsWithoutRow ?? [];
  // 桁送りがあるか、そもそも項目が 1 つ以下なら重ならない。
  if (cursor.recordHasSpacing || withoutRow.length < 2) return [];

  return [
    {
      code: "possible-overprint",
      message:
        `レコード ${cursor.recordName ?? ""} は行番号もスキップ／スペースも` +
        "指定していないため、同じ行に重ねて印刷されます" +
        "（原典: 2 重印刷が行われることがあります）",
      sourceLine: withoutRow[0]!
    }
  ];
}

/**
 * 重なりの検出。原典は「プリンターは 2 重印刷を行います」「警告メッセージが
 * 表示されます」と書いており **エラーではない**。
 * 幅不明の項目は判定できないので対象外。
 */
function detectOverlaps(items: readonly PlacedItem[]): LayoutDiagnostic[] {
  const found: LayoutDiagnostic[] = [];
  const measured = items.filter(item => item.width !== undefined);

  for (let i = 0; i < measured.length; i += 1) {
    for (let j = i + 1; j < measured.length; j += 1) {
      const a = measured[i]!;
      const b = measured[j]!;
      if (a.row !== b.row) continue;
      const aEnd = a.column + (a.width ?? 0);
      const bEnd = b.column + (b.width ?? 0);
      if (a.column < bEnd && b.column < aEnd) {
        found.push({
          code: "overlap",
          message:
            `${describe(a)} と ${describe(b)} が ${a.row} 行目で重なっています` +
            "（実機では 2 重印刷になります）",
          sourceLine: b.sourceLine
        });
      }
    }
  }
  return found;
}

function detectOverflow(
  items: readonly PlacedItem[],
  page: PrtfPage
): LayoutDiagnostic[] {
  const found: LayoutDiagnostic[] = [];
  for (const item of items) {
    if (item.row > page.rows) {
      found.push({
        code: "overflow",
        message: `${describe(item)} が紙面の行数（${page.rows}）を超えています`,
        sourceLine: item.sourceLine
      });
      continue;
    }
    const end = item.column + (item.width ?? 0) - 1;
    if (item.width !== undefined && end > page.columns) {
      found.push({
        code: "overflow",
        message: `${describe(item)} が紙面の桁数（${page.columns}）を超えています`,
        sourceLine: item.sourceLine
      });
    }
  }
  return found;
}

function describe(item: PlacedItem): string {
  return item.kind === "constant" ? `定数 '${item.text}'` : item.name ?? "項目";
}
