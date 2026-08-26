/**
 * 配置の検証。
 *
 * ## 検証するのは「配置」だけ
 *
 * キーワードの妥当性・型の整合は**検証しない**。DDS 原典が未収集で、
 * 踏み込むと根拠のない検証を作ることになる（L3 の範囲）。
 *
 * ## 重大度の扱いが肝（実機で確定）
 *
 * 隣接違反は実機の `CRTDSPF` が **`CPD7866` severity 10 = 警告**として扱い、
 * **コンパイルは通る**。したがってここでも**警告**とし、`patch` はこれで拒否しない。
 * **実機が通すものをエディタが止めると、既存 DDS を開いて一部だけ直すという
 * 本来の使い方ができなくなる。**
 *
 * 拒否してよいのはエラー級（桁溢れ・行範囲外・欄に収まらない長さ）だけ。
 */

import type { DdsDoc, DdsItem, ItemLine } from "./model.js";
import { displayWidth } from "../text/encoding.js";
import { DDS_COLUMNS } from "./lineLayout.js";

/** 診断の重大度。実機の severity に対応させている。 */
export type DiagnosticSeverity = "error" | "warning";

/** 診断コード。実機のメッセージ ID に対応するものはその旨を記す。 */
export const DIAGNOSTIC_CODES = {
  /** 画面の右端を越えている。 */
  overflow: "DDS7101",
  /** 同一行で要素が重なっている（属性バイトを除く実データの重なり）。 */
  overlap: "DDS7102",
  /** 属性バイトぶんの空きが無い（実機 `CPD7866` 相当）。 */
  attributeAdjacency: "DDS7103",
  /** 画面の行範囲を越えている。 */
  lineOutOfRange: "DDS7104",
  /** 長さが 30-34 桁の欄に収まらない。 */
  lengthOverflow: "DDS7105",
  /** 桁が 1 未満。 */
  posOutOfRange: "DDS7106",
  /** 内容や長さを判定できず、描画・検証の対象外になっている。 */
  widthUnknown: "DDS7107",
  /** 数値キーボードシフトなのに小数桁が空白（実機 `CPD7408` 相当）。 */
  missingDecimals: "DDS7108"
} as const;

export type DiagnosticCode =
  (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES];

/** 1 件の診断。 */
export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: DiagnosticCode;
  readonly message: string;
  /** 対象アイテムの ID。 */
  readonly itemId: string;
  /** 0 始まりのソース行番号（エディタでのジャンプ用）。 */
  readonly sourceLine: number;
}

/** 画面の大きさ。既定は 24×80（`*DS3`）。 */
export interface ScreenSize {
  readonly rows: number;
  readonly cols: number;
}

export const DEFAULT_SCREEN: ScreenSize = { rows: 24, cols: 80 };

/** 長さ欄（30-34 桁）に収まる最大値。 */
const MAX_LENGTH_FIELD =
  10 ** (DDS_COLUMNS.length.end - DDS_COLUMNS.length.start + 1) - 1;

/**
 * アイテムが画面上で占めるデータ幅（表示桁数）。
 *
 * - 定数: リテラルの表示桁数（**SO/SI 込み**）。
 *   実機の "Expanded Source" が `'社員番号'` を `Field length = 10` と報告することで裏付け済み。
 * - フィールド: DDS の長さ欄をそのまま表示桁数として扱う。
 *   **これは skeleton の割り切り**で、DBCS 対応の型（`O`/`E`/`G`/`J`）では長さの意味が変わる。
 *   標識・DBCS フィールドは後続 work の範囲。
 */
export function itemWidth(item: DdsItem): number | undefined {
  const content = itemContentWidth(item);
  if (content === undefined) {
    return undefined;
  }
  return content + signPositions(item);
}

/**
 * 画面に**見える内容**の桁数（符号位置を含まない）。
 *
 * 描画はこちらを使う。符号位置は画面上では空白なので、描く文字数には含まれない。
 */
export function itemContentWidth(item: DdsItem): number | undefined {
  if (item.kind === "constant") {
    return item.text === undefined ? undefined : displayWidth(item.text);
  }
  // 参照フィールド（REFFLD 等）は長さを DDS に書かないため undefined になる。
  // **幅 0 と決めつけない。** 0 として扱うと桁溢れも隣接も素通りし、
  // 「検証できないものを検証したふり」になる。
  return item.length;
}

/**
 * 符号位置が占める桁数（0 または 1）。
 *
 * **実機で確定した規則**（`CRTDSPF` に隣接配置を投げて `CPD7866` の有無で判定）:
 *
 * | 35 桁 | 使用 | 追加桁 |
 * |---|---|---|
 * | `S`（符号付き数値） | `B` / `I`（入力を伴う） | **+1** |
 * | `S` | `O`（出力のみ） | 0 |
 * | `Y`（数値のみ） | `B` / `O` | 0 |
 * | `A` | `B` | 0 |
 *
 * 符号を**入力する場所**が要るため、`S` かつ入力可のときだけ末尾に 1 桁増える。
 * `Y` は符号を持たないので増えない。
 *
 * **描画には影響しない**——符号位置は空白として表示されるため、
 * 描く内容は `itemContentWidth` のままで実機と一致する（AC7 で確認済み）。
 */
export function signPositions(item: DdsItem): number {
  if (item.kind !== "field") {
    return 0;
  }
  const inputCapable = item.usage === "B" || item.usage === "I";
  return effectiveDataType(item) === "S" && inputCapable ? 1 : 0;
}

/**
 * 数値キーボードシフト（35 桁）。**データ型そのものではない。**
 *
 * 原典（`docs/origin/dds/DDS-DSPF.pdf`）:
 * 「If you make a valid entry in positions 36 and 37, the data type is zoned decimal and
 *   the keyboard shift attribute is signed numeric (S)」
 * 「If you leave position 35 blank, the entry in positions 36 and 37 determines the data type」
 */
const NUMERIC_SHIFTS = new Set(["S", "Y"]);

/**
 * 実効的なデータ型を求める（実機の "Expanded Source" が示す正規化と同じ）。
 *
 * 実測（`CRTDSPF` の展開結果）:
 * - `5  0`（35 桁空白・小数あり） → **`5S 0`** に展開される（数値）
 * - `5   `（両方空白）           → **`5A  `** に展開される（文字）
 */
export function effectiveDataType(item: DdsItem): string | undefined {
  if (item.dataType !== undefined && item.dataType !== "") {
    return item.dataType;
  }
  if (item.kind !== "field") {
    return undefined;
  }
  return item.decimals !== undefined && item.decimals !== "" ? "S" : "A";
}

/** 実効的に数値フィールドか。 */
export function isNumericField(item: DdsItem): boolean {
  const type = effectiveDataType(item);
  return type !== undefined && NUMERIC_SHIFTS.has(type);
}

/** アイテムが配置されているか（行と桁を持つか）。 */
function isPlaced(
  item: DdsItem
): item is DdsItem & { line: number; pos: number } {
  return item.line !== undefined && item.pos !== undefined;
}

/**
 * 配置を検証する。
 *
 * @param doc 対象のモデル
 * @param screen 画面の大きさ（既定 24×80）
 */
export function validate(
  doc: DdsDoc,
  screen: ScreenSize = DEFAULT_SCREEN
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const placed = doc.lines
    .filter((line): line is ItemLine => line.kind === "item")
    .map(line => line.item)
    .filter(isPlaced);

  for (const item of placed) {
    const width = itemWidth(item);
    const last = width === undefined ? undefined : item.pos + width - 1;

    // 画面の右端。**属性バイトは含めない** — 右端で終わるフィールドの後続属性は
    // 画面外になるが、実機はこれを通す（実測）。
    if (last !== undefined && last > screen.cols) {
      diagnostics.push({
        severity: "error",
        code: DIAGNOSTIC_CODES.overflow,
        message:
          `${item.pos} 桁から ${width} 桁ぶんで ${last} 桁に達し、` +
          `画面の ${screen.cols} 桁を越えます`,
        itemId: item.id,
        sourceLine: item.lineIndex
      });
    }

    if (item.pos < 1) {
      diagnostics.push({
        severity: "error",
        code: DIAGNOSTIC_CODES.posOutOfRange,
        message: `桁は 1 以上である必要があります: ${item.pos}`,
        itemId: item.id,
        sourceLine: item.lineIndex
      });
    }

    if (item.line < 1 || item.line > screen.rows) {
      diagnostics.push({
        severity: "error",
        code: DIAGNOSTIC_CODES.lineOutOfRange,
        message:
          `行は 1〜${screen.rows} の範囲である必要があります: ${item.line}`,
        itemId: item.id,
        sourceLine: item.lineIndex
      });
    }

    if (width === undefined) {
      // 参照フィールド（長さ無し）やキーワード駆動の項目（DATE / TIME / USER 等）。
      // 描画も隣接判定も対象外になるため、**黙って消さずに理由を伝える**。
      // ここを黙っていると、キャンバスが実機と違って見える理由が誰にも分からない。
      diagnostics.push({
        severity: "warning",
        code: DIAGNOSTIC_CODES.widthUnknown,
        message:
          item.kind === "field"
            ? "長さが指定されていないため、描画と重なり検証の対象外です（参照フィールド等）"
            : "内容を判定できないため、描画と重なり検証の対象外です（DATE 等のキーワード項目）",
        itemId: item.id,
        sourceLine: item.lineIndex
      });
    }

    // 数値キーボードシフト（35 桁が S / Y）なのに小数桁が空白だと、
    // 実機の CRTDSPF が CPD7408 で落とす（実測）。**ここを通すと偽の緑になる。**
    if (
      item.kind === "field" &&
      item.dataType !== undefined &&
      NUMERIC_SHIFTS.has(item.dataType) &&
      (item.decimals === undefined || item.decimals === "")
    ) {
      diagnostics.push({
        severity: "error",
        code: DIAGNOSTIC_CODES.missingDecimals,
        message:
          `データ型 ${item.dataType}（数値キーボードシフト）には小数桁（` +
          `${DDS_COLUMNS.decimals.start}-${DDS_COLUMNS.decimals.end} 桁）が必要です。` +
          "空白のままだと実機のコンパイルが CPD7408 で落ちます",
        itemId: item.id,
        sourceLine: item.lineIndex
      });
    }

    if (item.length !== undefined && item.length > MAX_LENGTH_FIELD) {
      diagnostics.push({
        severity: "error",
        code: DIAGNOSTIC_CODES.lengthOverflow,
        message:
          `長さが ${DDS_COLUMNS.length.start}-${DDS_COLUMNS.length.end} 桁の欄に` +
          `収まりません: ${item.length}`,
        itemId: item.id,
        sourceLine: item.lineIndex
      });
    }
  }

  diagnostics.push(...checkAdjacency(placed));

  return diagnostics;
}

/**
 * 同一行の隣接を検査する。
 *
 * **実機で確定した規則**（spec D7）:
 * 隣り合う 2 要素 A(データ `a1..a2`) と B(`b1..`) について `b1 < a2 + 2` が違反。
 * 空き 1 桁を、A の後続属性バイトと B の先行属性バイトが**兼用する**ため、
 * 必要な空きは 2 桁ではなく **1 桁**。
 *
 * 実データそのものが重なっている場合（`b1 <= a2`）は、より強い問題として
 * 別コードで報告する。ただし**どちらも警告**——実機がコンパイルを通すため。
 */
function checkAdjacency(
  placed: readonly (DdsItem & { line: number; pos: number })[]
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const byLine = new Map<number, (DdsItem & { line: number; pos: number })[]>();

  for (const item of placed) {
    const list = byLine.get(item.line) ?? [];
    list.push(item);
    byLine.set(item.line, list);
  }

  for (const items of byLine.values()) {
    // **幅が不明なアイテムは隣接判定に加えない。**
    // 参照フィールド（長さを DDS に書かないもの）がこれに当たる。
    // 幅 0 と決めつけて比較すると、実際には違反している配置を素通りさせてしまう。
    // 検証できないものは検証しない——**できたふりをしない**のが本 subtask の方針。
    const sorted = [...items]
      .filter(item => itemWidth(item) !== undefined)
      .sort((a, b) => a.pos - b.pos);

    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      const previousLast = previous.pos + itemWidth(previous)! - 1;

      if (current.pos <= previousLast) {
        diagnostics.push({
          severity: "warning",
          code: DIAGNOSTIC_CODES.overlap,
          message:
            `${previous.id}（${previous.pos}〜${previousLast} 桁）と重なっています`,
          itemId: current.id,
          sourceLine: current.lineIndex
        });
        continue;
      }

      if (current.pos < previousLast + 2) {
        diagnostics.push({
          severity: "warning",
          code: DIAGNOSTIC_CODES.attributeAdjacency,
          message:
            `${previous.id}（${previous.pos}〜${previousLast} 桁）との間に` +
            `属性バイトぶんの空きがありません。${previousLast + 2} 桁以降に置いてください`,
          itemId: current.id,
          sourceLine: current.lineIndex
        });
      }
    }
  }

  return diagnostics;
}

/** 診断にエラーが含まれるか。 */
export function hasError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some(d => d.severity === "error");
}
