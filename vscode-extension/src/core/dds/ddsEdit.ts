import { DDS_COLUMNS, ddsField } from "../ddsLayout";
import { buildItemLine, writeBackLength, type NewDspfItem } from "./ddsEditWriteBack";
import {
  toLogicalUnits,
  unitItemKind,
  type LogicalUnit
} from "./ddsLogicalUnits";
import { writeBackPosition } from "./ddsPositionWriteBack";

/**
 * DDS ソースへの編集操作。**vscode を import しない**（行の配列 → 置き換え指示）。
 *
 * ## 判定は持たない
 *
 * ここが見るのは「**ソースに書けるか**」だけ。重なり・はみ出し・1 桁目の予約といった
 * 規則違反は `dspfLayout` が診断として返すもので、**編集は止めない**。
 * 既存の移動が無検証で適用される（`dspfPreview.ts`）のと同じ扱いにしてある——
 * 直すために動かしたい項目が、違反を理由に凍るのを避けるため。
 *
 * ## 戻り値は「旧行のどの範囲を、どの行で置き換えるか」
 *
 * 適用後の全文を返さないのは、**座標の取り違えを起こしようがなくする**ため。
 * 「適用後テキスト＋変更範囲」を返す設計は、その範囲を旧文書の座標として使った時点で
 * 行数が変わる操作（追加・削除）で壊れる（実際に踏んだ事例が
 * `.aidev/works/20260825-dds-visual-editor/07-editor-webview/review.md` の must-1）。
 *
 * ## 削除は論理単位ごと
 *
 * DDS の項目は 1 行とは限らない。キーワード継続行は直前に付き、条件付けの行は次に付く
 * （`ddsLogicalUnits`）。代表行だけ消すと**継続行が孤児として残る**。
 * 注記行・空行はどの単位にも属さないので消さない——結果として範囲は連続とは限らず、
 * だから戻り値は**配列**になっている。
 */

export type DdsEdit =
  | { readonly kind: "move"; readonly sourceLine: number; readonly row: number; readonly column: number }
  | { readonly kind: "resize"; readonly sourceLine: number; readonly length: number }
  | { readonly kind: "remove"; readonly sourceLine: number }
  | { readonly kind: "add"; readonly recordName: string; readonly item: NewDspfItem };

/** 置き換え指示。0 始まり・`replaceTo` は含まない。 */
export interface DdsEditResult {
  readonly replaceFrom: number;
  readonly replaceTo: number;
  /** 置き換え後の行。**空配列なら削除**。`replaceFrom === replaceTo` なら挿入。 */
  readonly lines: readonly string[];
}

/** 適用できない理由。**「ソースに書けない」ものだけ**が並ぶ。 */
export type DdsEditRejectionCode =
  | "line-not-found"
  | "length-out-of-range"
  | "position-out-of-range"
  | "record-not-found"
  | "constant-has-length"
  | "field-needs-name";

export interface DdsEditRejection {
  readonly code: DdsEditRejectionCode;
  readonly message: string;
  /** 1 始まり。宛先が行に紐づかない操作では undefined。 */
  readonly sourceLine?: number;
}

const LENGTH_WIDTH = DDS_COLUMNS.length[1] - DDS_COLUMNS.length[0] + 1;
/** 位置欄は行・桁とも 3 桁ずつ。 */
const POSITION_WIDTH = 3;

/**
 * 事前検証。**何も書かない。**
 *
 * 空配列なら適用できる。`applyDdsEdits` は同じ検査を通してから適用する。
 */
export function validateDdsEdits(
  lines: readonly string[],
  edits: readonly DdsEdit[]
): readonly DdsEditRejection[] {
  const units = toLogicalUnits(lines);
  const rejections: DdsEditRejection[] = [];

  for (const edit of edits) {
    if (edit.kind === "add") {
      rejections.push(...validateAdd(units, edit.recordName, edit.item));
      continue;
    }

    const unit = itemUnitAt(units, edit.sourceLine);
    if (!unit) {
      rejections.push({
        code: "line-not-found",
        message: `${edit.sourceLine} 行目に編集できる項目がありません（ソースが変わっている可能性があります）`,
        sourceLine: edit.sourceLine
      });
      continue;
    }

    if (edit.kind === "move") {
      rejections.push(...validatePosition(edit.row, edit.column, edit.sourceLine));
    }

    if (edit.kind === "resize") {
      if (unitItemKind(unit) === "constant") {
        rejections.push({
          code: "constant-has-length",
          message: "固定情報（定数）には桁数を指定できません",
          sourceLine: edit.sourceLine
        });
      } else if (!fitsInColumn(edit.length, LENGTH_WIDTH) || edit.length < 1) {
        rejections.push({
          code: "length-out-of-range",
          message: `長さ ${edit.length} は桁数欄（${LENGTH_WIDTH} 桁）に書けません`,
          sourceLine: edit.sourceLine
        });
      }
    }
  }

  return rejections;
}

/**
 * 適用する。**1 つでも書けない操作があれば空配列を返し、何も適用しない。**
 *
 * 返る指示は**行番号の降順**。先頭から順に適用しても、後続の指示の行番号がずれない。
 */
export function applyDdsEdits(
  lines: readonly string[],
  edits: readonly DdsEdit[]
): readonly DdsEditResult[] {
  if (validateDdsEdits(lines, edits).length > 0) {
    return [];
  }

  const units = toLogicalUnits(lines);
  const results: DdsEditResult[] = [];

  for (const edit of edits) {
    switch (edit.kind) {
      case "move":
      case "resize": {
        const unit = itemUnitAt(units, edit.sourceLine);
        if (!unit) break; // 検証済みなので通常は起きない。
        const index = edit.sourceLine - 1;
        const rewritten =
          edit.kind === "move"
            ? writeBackPosition({ line: lines[index], row: edit.row, column: edit.column })
            : writeBackLength(lines[index], edit.length);
        results.push({ replaceFrom: index, replaceTo: index + 1, lines: [rewritten] });
        break;
      }
      case "remove": {
        const unit = itemUnitAt(units, edit.sourceLine);
        if (!unit) break;
        results.push(...removalRuns(unit));
        break;
      }
      case "add": {
        const at = insertionPoint(units, edit.recordName);
        if (at === undefined) break;
        results.push({ replaceFrom: at, replaceTo: at, lines: [buildItemLine(edit.item)] });
        break;
      }
    }
  }

  // 降順にすると、先に適用した指示が後続の行番号を動かさない。
  return [...results].sort((a, b) => b.replaceFrom - a.replaceFrom);
}

/** 論理単位の行を、連続する塊ごとの削除指示に分ける（注記行を挟むと分かれる）。 */
function removalRuns(unit: LogicalUnit): DdsEditResult[] {
  const indexes = [...unit.sourceLines].sort((a, b) => a - b).map(line => line - 1);
  const runs: DdsEditResult[] = [];

  let start = indexes[0];
  let previous = indexes[0];
  for (const index of indexes.slice(1)) {
    if (index === previous + 1) {
      previous = index;
      continue;
    }
    runs.push({ replaceFrom: start, replaceTo: previous + 1, lines: [] });
    start = index;
    previous = index;
  }
  runs.push({ replaceFrom: start, replaceTo: previous + 1, lines: [] });
  return runs;
}

/**
 * 追加する位置＝**その様式の最後の論理単位の直後**（0 始まりの挿入点）。
 *
 * 様式が見つからなければ undefined（検証で弾かれている）。
 */
function insertionPoint(
  units: readonly LogicalUnit[],
  recordName: string
): number | undefined {
  const start = units.findIndex(
    unit => unit.kind === "record" && ddsName(unit.line).toUpperCase() === recordName.toUpperCase()
  );
  if (start < 0) {
    return undefined;
  }

  let last = units[start];
  for (const unit of units.slice(start + 1)) {
    if (unit.kind === "record") break;
    last = unit;
  }
  return Math.max(...last.sourceLines);
}

function validateAdd(
  units: readonly LogicalUnit[],
  recordName: string,
  item: NewDspfItem
): DdsEditRejection[] {
  const rejections: DdsEditRejection[] = [];

  if (insertionPoint(units, recordName) === undefined) {
    rejections.push({
      code: "record-not-found",
      message: `レコード様式 ${recordName} が見つかりません`
    });
  }

  if (item.kind === "field") {
    if ((item.name ?? "").trim().length === 0) {
      rejections.push({ code: "field-needs-name", message: "フィールドには名前が必要です" });
    }
    if (
      item.length !== undefined &&
      (!fitsInColumn(item.length, LENGTH_WIDTH) || item.length < 1)
    ) {
      rejections.push({
        code: "length-out-of-range",
        message: `長さ ${item.length} は桁数欄（${LENGTH_WIDTH} 桁）に書けません`
      });
    }
  } else if (item.length !== undefined) {
    rejections.push({
      code: "constant-has-length",
      message: "固定情報（定数）には桁数を指定できません"
    });
  }

  rejections.push(...validatePosition(item.row, item.column));
  return rejections;
}

function validatePosition(
  row: number,
  column: number,
  sourceLine?: number
): DdsEditRejection[] {
  const bad = (what: string, value: number): DdsEditRejection => ({
    code: "position-out-of-range",
    message: `${what} ${value} は位置欄（${POSITION_WIDTH} 桁）に書けません`,
    ...(sourceLine !== undefined ? { sourceLine } : {})
  });

  const rejections: DdsEditRejection[] = [];
  if (!fitsInColumn(row, POSITION_WIDTH) || row < 1) rejections.push(bad("行", row));
  if (!fitsInColumn(column, POSITION_WIDTH) || column < 1) {
    rejections.push(bad("桁", column));
  }
  return rejections;
}

/** その行にある「編集できる項目」の論理単位。レコード宣言行は対象外。 */
function itemUnitAt(
  units: readonly LogicalUnit[],
  sourceLine: number
): LogicalUnit | undefined {
  return units.find(unit => unit.kind === "item" && unit.sourceLine === sourceLine);
}

function fitsInColumn(value: number, width: number): boolean {
  return Number.isInteger(value) && String(Math.trunc(Math.abs(value))).length <= width;
}

function ddsName(line: string): string {
  return ddsField(line, DDS_COLUMNS.name).trim();
}
