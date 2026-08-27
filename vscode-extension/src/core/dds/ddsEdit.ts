import { DDS_COLUMNS, ddsField } from "../ddsLayout";
import {
  buildItemLine,
  writeBackAttributes,
  writeBackKeywordArea,
  writeBackLength,
  type ItemAttributePatch,
  type NewDspfItem
} from "./ddsEditWriteBack";
import {
  keywordAreaOf,
  replaceLeadingConstant,
  startsContinuation,
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
  /**
   * 項目の中身を変える。**与えた欄だけ**に触る。
   *
   * 欄ごとに操作を分けないのは、プロパティが「複数欄を直して 1 回確定する」使い方をするため。
   * 分けると 1 回の確定が N 個のパッチになり、**途中で 1 つ拒否されたときの状態が説明できない**。
   */
  | {
      readonly kind: "setAttributes";
      readonly sourceLine: number;
      readonly attributes: ItemAttributePatch & { readonly text?: string };
    }
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
  | "field-needs-name"
  | "name-too-long"
  | "decimals-out-of-range"
  | "field-column-on-constant"
  | "text-on-field"
  | "invalid-column-value"
  | "line-too-long"
  /**
   * キーワード欄が継続行にまたがっている。
   *
   * 継続（`-` / `+` / 引用符の開いたまま）で 2 行以上に分かれた値は、**代表行だけを
   * 書き換えると継続行が取り残されて壊れる**。折り直して書き出す仕組みが要るので、
   * この版では拒否する。**位置・長さの変更は拒否しない**（代表行の桁しか触らないため）。
   */
  | "keyword-continuation";

export interface DdsEditRejection {
  readonly code: DdsEditRejectionCode;
  readonly message: string;
  /** 1 始まり。宛先が行に紐づかない操作では undefined。 */
  readonly sourceLine?: number;
}

const LENGTH_WIDTH = DDS_COLUMNS.length[1] - DDS_COLUMNS.length[0] + 1;
const NAME_WIDTH = DDS_COLUMNS.name[1] - DDS_COLUMNS.name[0] + 1;
const DECIMALS_WIDTH = DDS_COLUMNS.decimals[1] - DDS_COLUMNS.decimals[0] + 1;
/**
 * 行の上限。lint の `line-length` と同じ 100 桁にそろえる。
 *
 * 原典は「仕様書の注記以外は 7-80 桁」としつつ、**81-100 桁の目盛りを持つ**ので
 * 80 では切らない（`src/lint/rules/lineLength.ts`）。判定を 2 か所に持たないため同じ値を使う。
 */
const MAX_LINE_COLUMNS = 100;
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

    if (edit.kind === "setAttributes") {
      rejections.push(...validateAttributes(lines, unit, edit.attributes, edit.sourceLine));
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
      case "setAttributes": {
        const unit = itemUnitAt(units, edit.sourceLine);
        if (!unit) break;
        const index = edit.sourceLine - 1;
        results.push({
          replaceFrom: index,
          replaceTo: index + 1,
          lines: [applyAttributes(lines[index], edit.attributes)]
        });
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

/** 属性を書き換えた行を作る。定数のリテラルは**先頭の 1 つだけ**を差し替える。 */
function applyAttributes(
  line: string,
  attributes: ItemAttributePatch & { text?: string }
): string {
  let next = writeBackAttributes(line, attributes);
  if (attributes.text !== undefined) {
    const replaced = replaceLeadingConstant(keywordAreaOf(next), attributes.text);
    if (replaced !== undefined) {
      next = writeBackKeywordArea(next, replaced);
    }
  }
  return next;
}

/**
 * 属性の変更が**ソースに書けるか**を見る。
 *
 * 規則違反（重なり・はみ出し）は見ない——それは `dspfLayout` の診断の担当で、
 * 編集は止めない（直すために変えたい、が成立するため）。
 */
function validateAttributes(
  lines: readonly string[],
  unit: LogicalUnit,
  attributes: ItemAttributePatch & { text?: string },
  sourceLine: number
): DdsEditRejection[] {
  const rejections: DdsEditRejection[] = [];
  const isConstant = unitItemKind(unit) === "constant";
  const at = (code: DdsEditRejectionCode, message: string): DdsEditRejection => ({
    code,
    message,
    sourceLine
  });

  const touchesFieldColumns =
    attributes.name !== undefined ||
    attributes.length !== undefined ||
    attributes.dataType !== undefined ||
    attributes.decimals !== undefined ||
    attributes.usage !== undefined;

  if (isConstant && touchesFieldColumns) {
    rejections.push(
      at("field-column-on-constant", "固定情報（定数）には名前や桁数を指定できません")
    );
  }
  if (!isConstant && attributes.text !== undefined) {
    rejections.push(at("text-on-field", "フィールドにリテラルは書けません"));
  }

  // 継続行にまたがるキーワード欄は書き換えない（折り直す仕組みが無い）。
  // **キーワード欄を触るものだけ**が対象——位置・長さは代表行の桁しか触らない。
  // 別の行に書かれた普通のキーワード（`OVERLAY` など）は継続ではないので拒否しない
  // （代表行の欄を書き換えても、その行はそのまま残って壊れない）。
  if (attributes.text !== undefined && startsContinuation(unit.line)) {
    rejections.push(
      at(
        "keyword-continuation",
        "キーワード欄が継続行にまたがっています（この版では書き換えません）"
      )
    );
  }

  if (attributes.name !== undefined) {
    const name = attributes.name.trim();
    if (name.length === 0) {
      rejections.push(at("field-needs-name", "フィールドには名前が必要です"));
    } else if (name.length > NAME_WIDTH) {
      rejections.push(
        at("name-too-long", `名前は ${NAME_WIDTH} 桁までです（${name.length} 桁）`)
      );
    }
  }
  if (
    attributes.length !== undefined &&
    (!fitsInColumn(attributes.length, LENGTH_WIDTH) || attributes.length < 1)
  ) {
    rejections.push(
      at("length-out-of-range", `長さ ${attributes.length} は桁数欄に書けません`)
    );
  }
  if (
    attributes.decimals !== undefined &&
    (!fitsInColumn(attributes.decimals, DECIMALS_WIDTH) || attributes.decimals < 0)
  ) {
    rejections.push(
      at("decimals-out-of-range", `小数桁 ${attributes.decimals} は小数点以下桁数欄に書けません`)
    );
  }
  for (const [label, value] of [
    ["データ・タイプ", attributes.dataType],
    ["使用", attributes.usage]
  ] as const) {
    if (value !== undefined && value.trim().length > 1) {
      rejections.push(at("invalid-column-value", `${label}は 1 桁です（"${value}"）`));
    }
  }

  // 書き換えた結果が行の上限を超えるなら書けない。
  const next = applyAttributes(lines[sourceLine - 1] ?? "", attributes);
  if (next.length > MAX_LINE_COLUMNS) {
    rejections.push(
      at("line-too-long", `書き換えると ${next.length} 桁になり、${MAX_LINE_COLUMNS} 桁を超えます`)
    );
  }

  return rejections;
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
