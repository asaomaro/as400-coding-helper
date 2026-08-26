/**
 * 構造化パッチ（L1 の 4 操作）。
 *
 * ## GUI と CLI が同じ経路を通る（AC4 を構造で保証する）
 *
 * **GUI の L1 操作はこの 4 種と 1:1 で対応する。** GUI 独自の編集経路は作らない。
 * 「CLI が GUI と同等」を努力目標ではなく構造で担保するための設計。
 *
 * ## ID はその版のモデルの中でだけ有効
 *
 * `applyOps` は適用後に**再パースして新しいモデルを返す**。パーサを唯一の解釈経路に
 * 保つためだが、副作用として **`addItem` / `removeItem` の後は ID が振り直される**
 * （`REC1#1` を消すと元の `REC1#2` が新しい `REC1#1` になる）。
 *
 * - `moveItem` / `resizeItem`（構造不変）→ **ID は変わらない**
 * - `addItem` / `removeItem`（構造変更）→ **ID が振り直される**
 *
 * 呼び出し側は、構造を変えたら**返された新しいモデルから ID を取り直す**こと。
 * 古い ID を使い続けると**別のアイテムを操作してしまう**。
 *
 * ## 拒否するのは「このパッチが作ったエラー」だけ
 *
 * **文書全体を見てエラーがあれば拒否する、という作りにしてはならない。**
 * 実務の DDS は元からエラーを含んでいることがあり、そうすると
 * **無関係な箇所すら編集できず、そのファイルが実質読み取り専用になる**。
 * それは requirement US2（既存資産を開いて一部だけ直す）を否定する。
 *
 * エラー級の診断（桁溢れ・行範囲外・長さ欄溢れ）は**アイテム単位で独立**しているので、
 * **パッチが触った行に紐づくエラーだけ**を見て判断する。
 *
 * ## 部分適用しない
 *
 * 複数の操作のうち 1 つでも拒否されたら、**何も適用せずに終わる**。
 * 途中まで適用した状態を返すと、呼び出し側が「どこまで進んだか」を知る手段がない。
 * そのために**まず全操作を元のモデル上で解決し、最後に一度だけ行を組み立てる**
 * （2 段階にすることで、行番号のずれ計算そのものが要らなくなる）。
 */

import type { DdsDoc, DdsItem } from "../dds/model.js";
import { parse } from "../dds/parse.js";
import { rewriteLine, serialize, type ColumnChange } from "../dds/serialize.js";
import { DDS_COLUMNS } from "../dds/lineLayout.js";
import { displayWidth } from "../text/encoding.js";
import {
  validate,
  type Diagnostic,
  DEFAULT_SCREEN,
  type ScreenSize
} from "../dds/validate.js";

/** アイテムを移動する。 */
export interface MoveItemOp {
  readonly op: "moveItem";
  readonly id: string;
  readonly line: number;
  readonly pos: number;
}

/** フィールドの長さを変える。 */
export interface ResizeItemOp {
  readonly op: "resizeItem";
  readonly id: string;
  readonly length: number;
}

/** 新しいアイテムを追加する。 */
export interface AddItemOp {
  readonly op: "addItem";
  readonly record: string;
  readonly item: NewItem;
}

/** アイテムを削除する。 */
export interface RemoveItemOp {
  readonly op: "removeItem";
  readonly id: string;
}

/** L1 の操作。GUI の操作とこの 4 種が 1:1 で対応する。 */
export type PatchOp = MoveItemOp | ResizeItemOp | AddItemOp | RemoveItemOp;

/** 追加するアイテムの指定。 */
export interface NewItem {
  readonly kind: "field" | "constant";
  readonly name?: string;
  readonly text?: string;
  readonly length?: number;
  /** キーボードシフト属性（35 桁）。**データ型そのものではない**（原典 / 実機で確認）。 */
  readonly dataType?: string;
  /**
   * 小数桁（36-37 桁）。
   *
   * **数値キーボードシフト（`S` / `Y`）では必須。** 空白のままだと実機の `CRTDSPF` が
   * `CPD7408`（Entry for decimal positions or field length not valid）で落とす。
   * 35 桁を空白にしてここに値を入れると、コンパイラが `S`（ゾーン 10 進）と解釈する。
   */
  readonly decimals?: number;
  readonly usage?: string;
  readonly line: number;
  readonly pos: number;
}

/** 変更が及んだ行の範囲（0 始まり・`end` は含まない）。 */
export interface ChangedLines {
  readonly start: number;
  readonly end: number;
}

/** `applyOps` の結果。 */
export interface ApplyResult {
  /** 適用後のテキスト。 */
  readonly text: string;
  /** 適用後のモデル（**構造を変えた場合、ID は振り直されている**）。 */
  readonly doc: DdsDoc;
  /** 変更が及んだ行の範囲。VSCode 側が全文置換を避けるために使う。 */
  readonly changedLines: ChangedLines;
  /** 適用後の診断（警告を含む）。 */
  readonly diagnostics: readonly Diagnostic[];
}

/** パッチが拒否された理由。 */
export class PatchRejectedError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(message: string, diagnostics: readonly Diagnostic[] = []) {
    super(message);
    this.name = "PatchRejectedError";
    this.diagnostics = diagnostics;
  }
}

/** 元の行に対する解決済みの指示。 */
interface Resolved {
  /** 行ごとの差し替え後テキスト（未変更なら undefined）。 */
  readonly replaced: Map<number, string>;
  /** 削除する元の行番号。 */
  readonly removed: Set<number>;
  /** 元の行番号の**直前**に挿入する行。 */
  readonly inserted: Map<number, string[]>;
}

/**
 * 操作を適用する。
 *
 * **エラー級の違反を生む操作は拒否する。警告（隣接違反など）では拒否しない**
 * ——実機がコンパイルを通すものをエディタが止めるのは過剰（spec D7）。
 *
 * @throws PatchRejectedError 対象が見つからない / エラー級の違反を生む場合
 */
export function applyOps(
  doc: DdsDoc,
  ops: readonly PatchOp[],
  screen: ScreenSize = DEFAULT_SCREEN
): ApplyResult {
  const resolved = resolveOps(doc, ops);
  const { raws, changedLines, touched } = rebuild(doc, resolved);

  const text = serialize({
    ...doc,
    lines: raws.map(raw => ({ kind: "opaque" as const, raw }))
  });

  const next = parse(text, {
    lineWidth: doc.lineWidth,
    encoding: doc.encoding,
    bom: doc.bom
  });

  const diagnostics = validate(next, screen);

  // **エラーが「増えた」ときだけ拒否する**（spec:「検証違反を**生む**パッチは拒否」）。
  //
  // 当初は「触った行にエラーがあれば拒否」としていたが、これだと
  // **元からエラーを持つ項目を動かせない**——小数桁が抜けたフィールドをレイアウト修正で
  // 動かそうとしても、移動が違反を生んでいないのに拒否される。
  // 実際 07 の GUI で「掴んでも動かない」として現れた（07 `decisions.md` D14）。
  //
  // 判定は**コードごとの件数の増減**で行う。行番号や ID で突き合わせないのは、
  // `addItem` / `removeItem` で行がずれ、ID も振り直されるため
  // （04 の設計。同じ理由で「同じ診断か」を同定する安定な鍵が無い）。
  const introduced = increasedErrors(validate(doc, screen), diagnostics);
  if (introduced.length > 0) {
    // 触った行のものがあればそれを返す（利用者にとって原因が近いのはこちら）。
    const nearby = introduced.filter(d => touched.has(d.sourceLine));
    // ここに来た時点でまだ何も返していない。**呼び出し側から見て部分適用は起きない。**
    throw new PatchRejectedError(
      "この操作はエラー級の違反を生みます（適用していません）",
      nearby.length > 0 ? nearby : introduced
    );
  }

  return { text, doc: next, changedLines, diagnostics };
}

/**
 * 適用後に**件数が増えたエラー**を返す。増えていないコードは元からあったものとみなす。
 *
 * 「1 件直して 1 件増やした」（件数が同じ）操作は素通りするが、それは
 * **エディタが止めるほどの害ではない**——検証結果は `ApplyResult.diagnostics` で必ず返るので、
 * 利用者にも AI にも見えている。ここで厳しくすると、直しながら動かす編集が全部止まる。
 */
function increasedErrors(
  before: readonly Diagnostic[],
  after: readonly Diagnostic[]
): Diagnostic[] {
  const countByCode = (diagnostics: readonly Diagnostic[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity === "error") {
        counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + 1);
      }
    }
    return counts;
  };

  const beforeCounts = countByCode(before);
  const afterCounts = countByCode(after);

  return after.filter(
    diagnostic =>
      diagnostic.severity === "error" &&
      (afterCounts.get(diagnostic.code) ?? 0) >
        (beforeCounts.get(diagnostic.code) ?? 0)
  );
}

/** 全操作を**元のモデル上で**解決する。ここでは行を組み立てない。 */
function resolveOps(doc: DdsDoc, ops: readonly PatchOp[]): Resolved {
  const itemIndex = new Map<string, { item: DdsItem; index: number }>();
  doc.lines.forEach((line, index) => {
    if (line.kind === "item") {
      itemIndex.set(line.item.id, { item: line.item, index });
    }
  });

  const replaced = new Map<number, string>();
  const removed = new Set<number>();
  const inserted = new Map<number, string[]>();

  const find = (id: string): { item: DdsItem; index: number } => {
    const found = itemIndex.get(id);
    if (found === undefined) {
      throw new PatchRejectedError(`アイテムが見つかりません: ${id}`);
    }
    return found;
  };

  for (const op of ops) {
    switch (op.op) {
      case "moveItem": {
        const { index } = find(op.id);
        replaced.set(
          index,
          rewriteLine(
            replaced.get(index) ?? doc.lines[index].raw,
            [
              numberChange(DDS_COLUMNS.line, op.line),
              numberChange(DDS_COLUMNS.pos, op.pos)
            ],
            doc.lineWidth
          )
        );
        break;
      }
      case "resizeItem": {
        const { index } = find(op.id);
        replaced.set(
          index,
          rewriteLine(
            replaced.get(index) ?? doc.lines[index].raw,
            [numberChange(DDS_COLUMNS.length, op.length)],
            doc.lineWidth
          )
        );
        break;
      }
      case "removeItem": {
        const { index } = find(op.id);
        removed.add(index);
        break;
      }
      case "addItem": {
        const at = insertionPoint(doc, op.record);
        const list = inserted.get(at) ?? [];
        list.push(buildItemLine(op.item, doc.lineWidth));
        inserted.set(at, list);
        break;
      }
    }
  }

  return { replaced, removed, inserted };
}

/** 解決済みの指示から、最終的な行の配列を一度だけ組み立てる。 */
function rebuild(
  doc: DdsDoc,
  resolved: Resolved
): { raws: string[]; changedLines: ChangedLines; touched: Set<number> } {
  const raws: string[] = [];
  // パッチが触った**新しい配列での**行番号。拒否判定はこの範囲に限って行う。
  const touched = new Set<number>();
  let firstTouched = Number.POSITIVE_INFINITY;
  let lastTouched = -1;
  let structural = false;

  const pushInsertions = (originalIndex: number): void => {
    const list = resolved.inserted.get(originalIndex);
    if (list === undefined) {
      return;
    }
    structural = true;
    for (const raw of list) {
      firstTouched = Math.min(firstTouched, raws.length);
      lastTouched = Math.max(lastTouched, raws.length);
      touched.add(raws.length);
      raws.push(raw);
    }
  };

  doc.lines.forEach((line, originalIndex) => {
    pushInsertions(originalIndex);

    if (resolved.removed.has(originalIndex)) {
      structural = true;
      firstTouched = Math.min(firstTouched, raws.length);
      return;
    }

    const replacement = resolved.replaced.get(originalIndex);
    if (replacement !== undefined) {
      firstTouched = Math.min(firstTouched, raws.length);
      lastTouched = Math.max(lastTouched, raws.length);
      touched.add(raws.length);
      raws.push(replacement);
      return;
    }

    raws.push(line.raw);
  });

  // 末尾への挿入（最終行の次を指す指定）。
  pushInsertions(doc.lines.length);

  if (firstTouched === Number.POSITIVE_INFINITY) {
    return { raws, changedLines: { start: 0, end: 0 }, touched };
  }

  // 構造が変わると以降の行番号がずれるため、末尾までを変更範囲とする。
  return {
    raws,
    changedLines: structural
      ? { start: firstTouched, end: raws.length }
      : { start: firstTouched, end: lastTouched + 1 },
    touched
  };
}

function numberChange(
  range: { readonly start: number; readonly end: number },
  value: number
): ColumnChange {
  const width = range.end - range.start + 1;
  const text = String(value).padStart(width);
  if (text.length !== width) {
    throw new PatchRejectedError(
      `値が ${range.start}-${range.end} 桁の欄に収まりません: ${value}`
    );
  }
  return { col: range.start, width, text };
}

/**
 * 追加位置（元の行番号。その**直前**に挿入する）を決める。
 *
 * レコード様式の**末尾**に足す。**継続行（opaque）の途中に割り込まない**よう、
 * 次の様式宣言の位置まで進める。
 */
function insertionPoint(doc: DdsDoc, record: string): number {
  const recordIndex = doc.lines.findIndex(
    line => line.kind === "record" && line.name === record
  );
  if (recordIndex < 0) {
    throw new PatchRejectedError(`レコード様式が見つかりません: ${record}`);
  }

  let index = recordIndex + 1;
  while (index < doc.lines.length && doc.lines[index].kind !== "record") {
    index += 1;
  }
  return index;
}

/** 新しいアイテムの行を組み立てる。 */
function buildItemLine(item: NewItem, lineWidth: number): string {
  const changes: ColumnChange[] = [
    { col: DDS_COLUMNS.formType.start, width: 1, text: "A" },
    numberChange(DDS_COLUMNS.line, item.line),
    numberChange(DDS_COLUMNS.pos, item.pos)
  ];

  if (item.kind === "field") {
    if (item.name === undefined || item.name === "") {
      throw new PatchRejectedError("フィールドには名前が必要です");
    }
    changes.push(padRight(DDS_COLUMNS.name, item.name));
    if (item.length !== undefined) {
      changes.push(numberChange(DDS_COLUMNS.length, item.length));
    }
    if (item.dataType !== undefined) {
      changes.push(padRight(DDS_COLUMNS.dataType, item.dataType));
    }
    if (item.decimals !== undefined) {
      changes.push(numberChange(DDS_COLUMNS.decimals, item.decimals));
    }
    if (item.usage !== undefined) {
      changes.push(padRight(DDS_COLUMNS.usage, item.usage));
    }
  } else {
    if (item.text === undefined) {
      throw new PatchRejectedError("定数には内容が必要です");
    }
    // リテラルは機能欄の先頭に置く。内部の引用符は 2 個重ねる。
    const literal = `'${item.text.replace(/'/g, "''")}'`;
    const width = displayWidth(literal);
    if (DDS_COLUMNS.functions.start + width - 1 > lineWidth) {
      throw new PatchRejectedError(
        `定数が行幅 ${lineWidth} 桁に収まりません（${width} 桁必要）`
      );
    }
    changes.push({ col: DDS_COLUMNS.functions.start, width, text: literal });
  }

  return rewriteLine("", changes, lineWidth);
}

function padRight(
  range: { readonly start: number; readonly end: number },
  value: string
): ColumnChange {
  const width = range.end - range.start + 1;
  if (value.length > width) {
    throw new PatchRejectedError(
      `${range.start}-${range.end} 桁の欄に収まりません: ${value}`
    );
  }
  return { col: range.start, width, text: value.padEnd(width) };
}
