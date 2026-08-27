import { DDS_COLUMNS, ddsField, ddsName } from "../ddsLayout";
import { describeConditioning, readConditioning } from "./ddsConditioning";
import { NON_DISPLAY_USAGE } from "./dspfLayout";
import {
  keywordAreaOf,
  readConstant,
  readNumber,
  toLogicalUnits,
  unitItemKind
} from "./ddsLogicalUnits";

/**
 * 様式と項目の一覧。**配置の解決を通さない。**
 *
 * ## なぜ `resolveDspfLayout` から作らないか
 *
 * 配置解決は**画面に置けない項目を落とす**——位置欄が空（`missing-position`）、
 * 数字でない（`invalid-position`）、画面に出ない用途（`H`/`P`/`M`）。
 * 落ちた項目はキャンバスに描かれないので、**一覧までそこから作ると GUI からは
 * 存在しないのと同じ**になり、直すにはテキストエディタへ戻るしかなくなる。
 *
 * そこで一覧は `toLogicalUnits`（行を項目にまとめるだけ）から作り、
 * **描かれない項目には理由を添えて**並べる。
 *
 * ## 選択の鍵は `sourceLine`
 *
 * キャンバス（`RenderItem`）と一覧（`OutlineItem`）は `sourceLine` で対応づく。
 * 鍵が 1 つなので、どちらで選んでも同期する。
 */

/** プロパティが出す値。**キーワードは解釈しない**（生テキスト）。 */
export interface ItemAttributes {
  readonly name?: string;
  readonly text?: string;
  readonly length?: number;
  readonly dataType?: string;
  readonly decimals?: number;
  readonly usage?: string;
  readonly keywords: string;
  /**
   * 条件付け（7-16 桁）を人が読む形にしたもの。例 `01 かつ N02、または 03`。
   * 条件が無ければ**鍵ごと無い**。
   *
   * 生の桁ではなく読める形で持つのは、条件が**項目の行より前の行**に書かれうるため
   * ——プロパティに 1 行の文字列として出せないと、ソースを目で追うしかなくなる。
   */
  readonly condition?: string;
}

/**
 * キャンバスに描かれない理由。描かれるなら undefined。
 *
 * `condition-off` だけは**構造ではなく状態**（利用者が指定した標識）で決まるので、
 * `buildDspfOutline` は付けない——付けるのは `applyIndicators`（`dspfRenderModel`）。
 * 構造的な理由が既にある項目には**上書きしない**（位置が無い項目は、
 * 標識をどう倒しても描かれないため、そちらを先に伝えるほうが直しに繋がる）。
 */
export type HiddenReason =
  | "no-position"
  | "invalid-position"
  | "not-displayed"
  | "condition-off";

export interface OutlineItem {
  /** 1 始まり。**選択の宛先**（`RenderItem.sourceLine` と同じ鍵）。 */
  readonly sourceLine: number;
  readonly kind: "field" | "constant";
  /** 一覧に出す名札（フィールドは名前、定数はリテラル）。 */
  readonly label: string;
  readonly attributes: ItemAttributes;
  /** 画面上の位置（読めたときだけ）。 */
  readonly row?: number;
  readonly column?: number;
  readonly hidden?: HiddenReason;
}

export interface OutlineRecord {
  readonly name: string;
  readonly sourceLine: number;
  readonly items: readonly OutlineItem[];
  /**
   * 様式宣言の行（と、その継続行）のキーワード欄。**解釈しない**（生テキスト）。
   *
   * `OVERLAY` / `CF03` のような**レコード・レベルのキーワードはここにしか無い**。
   * 項目の一覧だけを持っていると、デザイナからはこれらが一切読めない。
   */
  readonly keywords: string;
}

/**
 * 様式ごとの項目一覧を作る。
 *
 * 様式宣言より前に現れた項目は、名前の無い先頭の束（`name: ""`）にまとめる
 * （ファイルレベルのキーワードだけなら束は作らない）。
 */
export function buildDspfOutline(lines: readonly string[]): OutlineRecord[] {
  interface Building {
    name: string;
    sourceLine: number;
    items: OutlineItem[];
    keywords: string;
  }

  const records: Building[] = [];
  let current: Building | undefined;

  for (const unit of toLogicalUnits(lines)) {
    if (unit.kind === "record") {
      current = {
        name: ddsName(unit.line),
        sourceLine: unit.sourceLine,
        items: [],
        keywords: unit.keywords
      };
      records.push(current);
      continue;
    }

    if (!current) {
      // 様式宣言より前に現れた項目（本来は不正）。捨てずに名前の無い束へ入れる。
      current = { name: "", sourceLine: unit.sourceLine, items: [], keywords: "" };
      records.push(current);
    }

    current.items.push(toOutlineItem(unit));
  }

  return records;
}

function toOutlineItem(unit: ReturnType<typeof toLogicalUnits>[number]): OutlineItem {
  const line = unit.line;
  const keywords = unit.keywords;
  const kind = unitItemKind(unit);
  const text = kind === "constant" ? readConstant(keywordAreaOf(line)) : undefined;
  const name = ddsName(line) || undefined;
  const usage = ddsField(line, DDS_COLUMNS.usage).trim().toUpperCase() || undefined;

  const rowText = ddsField(line, [DDS_COLUMNS.position[0], DDS_COLUMNS.position[0] + 2]);
  const columnText = ddsField(line, [DDS_COLUMNS.position[0] + 3, DDS_COLUMNS.position[1]]);
  const row = readNumber(rowText);
  const column = readNumber(columnText);

  const hidden = hiddenReason(usage, rowText, columnText, row, column);
  const condition = describeConditioning(readConditioning(unit.conditioningLines));

  return {
    sourceLine: unit.sourceLine,
    kind,
    label: kind === "constant" ? (text ?? "") : (name ?? ""),
    attributes: {
      ...(name !== undefined ? { name } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(readNumber(ddsField(line, DDS_COLUMNS.length)) !== undefined
        ? { length: readNumber(ddsField(line, DDS_COLUMNS.length)) }
        : {}),
      ...(ddsField(line, DDS_COLUMNS.dataType).trim()
        ? { dataType: ddsField(line, DDS_COLUMNS.dataType).trim().toUpperCase() }
        : {}),
      ...(readNumber(ddsField(line, DDS_COLUMNS.decimals)) !== undefined
        ? { decimals: readNumber(ddsField(line, DDS_COLUMNS.decimals)) }
        : {}),
      ...(usage !== undefined ? { usage } : {}),
      keywords,
      ...(condition.length > 0 ? { condition } : {})
    },
    ...(row !== undefined ? { row } : {}),
    ...(column !== undefined ? { column } : {}),
    ...(hidden !== undefined ? { hidden } : {})
  };
}

/**
 * キャンバスに描かれない理由。`resolveDspfLayout` が落とす条件と**同じ順序**で見る。
 *
 * 用途の集合は `dspfLayout` から import している（同じ規則を 2 か所に持たない）。
 * 順序が食い違うと「一覧には理由が出ているのにキャンバスには描かれている」等のずれが起きるので、
 * **`dspfOutline.test.ts` が両者の食い違いを検査している**。
 */
function hiddenReason(
  usage: string | undefined,
  rowText: string,
  columnText: string,
  row: number | undefined,
  column: number | undefined
): HiddenReason | undefined {
  if (usage !== undefined && NON_DISPLAY_USAGE.has(usage)) {
    return "not-displayed";
  }
  if (
    (rowText.trim().length > 0 && row === undefined) ||
    (columnText.trim().length > 0 && column === undefined)
  ) {
    return "invalid-position";
  }
  if (row === undefined || column === undefined) {
    return "no-position";
  }
  return undefined;
}
