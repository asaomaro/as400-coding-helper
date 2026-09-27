import { ddsField, ddsName } from "../ddsLayout";
import { parseKeywordEntries } from "./ddsKeywords";
import type { LogicalUnit } from "./ddsLogicalUnits";
import { DDS_POSITION_ROW } from "./ddsPositionColumns";

/**
 * 表示装置ファイルの**ウィンドウ**（`WINDOW`）と**サブファイルの 1 ページの行数**（`SFLPAG`）を、
 * 様式ごとに解く。
 *
 * **vscode を import しない。** 位置は画面の絶対位置に直さず、「枠がどこにあるか」と
 * 「中の位置を画面に直すときに足す量」だけを返す。項目の位置欄は**ソースに書いてある値のまま**
 * 持つ——書き戻しはソースの値でするので、描く側（UI）でだけ足す。
 *
 * ## 位置の直し方（原典 `WINDOW` の例 1）
 *
 * > 下枠行 = 上枠行 + ウィンドウ行 + 1
 * > 右枠桁 = 左枠桁 + ウィンドウ桁 + 3
 * > 実際のフィールド行 = 上枠行 + フィールドの行番号
 * > 実際のフィールド桁 = 左枠桁 + フィールドの桁 + 1
 *
 * 例 1 の `WINDOW(4 20 9 30)` で `2 10` の項目は画面の 6 行 31 桁、例 3 の
 * `WINDOW(8 25 10 50)` で `4 5` のサブファイルの項目は画面の 12 行 31 桁（原典の記述どおり）。
 *
 * ## ウィンドウに入る様式（原典）
 *
 * - `WINDOW(開始行 開始桁 行数 桁数)` / `WINDOW(*DFT 行数 桁数)` … ウィンドウを定義する様式。
 * - `WINDOW(様式名)` … 「定義中のレコード様式を他のレコード様式で定義されたウィンドウに表示する」。
 * - サブファイル … 例 3「サブファイル・レコードおよびサブファイル制御レコードの両方のフィールドは、
 *   ウィンドウの左上隅の初めの使用可能ウィンドウ桁と関連して位置付けされます」。
 *   制御様式（`SFLCTL(サブファイル名)`）がウィンドウに入れば、サブファイルも入る。
 *
 * ## 開始位置が決まらないもの
 *
 * `*DFT`（カーソルの位置で決まる）と `&フィールド`（プログラムが決める）は、**ソースから開始位置が
 * 決まらない**。大きさは分かるので、画面の左上（1 行 1 桁）に仮に置いて `startKnown: false` を付ける。
 * 描かないと中の項目が画面の絶対位置に描かれ、見出しの上に重なる（D12 の不具合そのもの）。
 */
export interface DspfWindow {
  /** ウィンドウを**定義している**様式。 */
  readonly recordName: string;
  /** 様式の行（1 始まり）。 */
  readonly sourceLine: number;
  /** 枠の左上隅の行・桁（1 始まり）。 */
  readonly top: number;
  readonly left: number;
  /** 下枠の行・右枠の桁（原典の式）。 */
  readonly bottom: number;
  readonly right: number;
  /** ウィンドウ行数・桁数（枠を含まない）。 */
  readonly lines: number;
  readonly positions: number;
  /** 最終行をメッセージ行に使う（既定 `*MSGLIN`）。その行には項目を置けない。 */
  readonly messageLine: boolean;
  /** 開始位置がソースで決まっているか（`*DFT` / `&フィールド` は決まらない）。 */
  readonly startKnown: boolean;
  /** このウィンドウに表示される様式（定義している様式・参照する様式・中のサブファイル）。 */
  readonly records: readonly string[];
}

/** 中の位置を画面の位置に直すときに足す量。 */
export interface WindowOrigin {
  readonly row: number;
  readonly column: number;
}

export function windowOrigin(window: Pick<DspfWindow, "top" | "left">): WindowOrigin {
  return { row: window.top, column: window.left + 1 };
}

/** 項目を置ける範囲（ウィンドウの中の行・桁）。メッセージ行には置けない。 */
export function windowBounds(window: Pick<DspfWindow, "lines" | "positions" | "messageLine">): {
  rows: number;
  columns: number;
} {
  return { rows: window.messageLine ? window.lines - 1 : window.lines, columns: window.positions };
}

/** サブファイルを 1 ページぶん並べる指定。 */
export interface SubfileRepeat {
  /** 1 ページのレコード数（`SFLPAG`）。 */
  readonly count: number;
  /** サブファイル・レコード 1 件が占める行数。 */
  readonly rowStep: number;
}

export interface DspfRecordContext {
  /** 定義した様式の順。 */
  readonly windows: readonly DspfWindow[];
  /** 様式名 → その様式が入るウィンドウ。 */
  readonly windowOf: ReadonlyMap<string, DspfWindow>;
  /** サブファイル様式名 → 1 ページぶんの並べ方。 */
  readonly subfileRepeat: ReadonlyMap<string, SubfileRepeat>;
}

interface RecordKeywords {
  readonly name: string;
  readonly sourceLine: number;
  readonly entries: ReturnType<typeof parseKeywordEntries>;
}

function keywordParameters(record: RecordKeywords, keyword: string): string | undefined {
  return record.entries.find(entry => entry.kind === "keyword" && entry.name === keyword)?.parameters;
}

const NUMBER = /^\d+$/u;

/** `WINDOW` の定義形を読む。参照形（様式名 1 つ）や読めないものは undefined。 */
function readWindowDefinition(record: RecordKeywords): DspfWindow | undefined {
  const parameters = keywordParameters(record, "WINDOW");
  if (parameters === undefined) return undefined;
  const words = parameters.trim().toUpperCase().split(/\s+/u).filter(word => word.length > 0);
  const options = words.filter(word => word.startsWith("*") && word !== "*DFT");
  const values = words.filter(word => !options.includes(word));

  let start: { top: number; left: number } | undefined;
  let size: string[];
  if (values[0] === "*DFT") {
    size = values.slice(1, 3);
  } else if (values.length >= 4) {
    const [line, position] = values;
    size = values.slice(2, 4);
    if (NUMBER.test(line) && NUMBER.test(position)) start = { top: Number(line), left: Number(position) };
  } else {
    return undefined;
  }
  if (size.length !== 2 || !size.every(value => NUMBER.test(value))) return undefined;
  const lines = Number(size[0]);
  const positions = Number(size[1]);
  const top = start?.top ?? 1;
  const left = start?.left ?? 1;

  return {
    recordName: record.name,
    sourceLine: record.sourceLine,
    top,
    left,
    bottom: top + lines + 1,
    right: left + positions + 3,
    lines,
    positions,
    messageLine: !options.includes("*NOMSGLIN"),
    startKnown: start !== undefined,
    records: []
  };
}

/** 論理単位から様式ごとの文脈を作る。 */
export function resolveRecordContext(units: readonly LogicalUnit[]): DspfRecordContext {
  const records: RecordKeywords[] = [];
  // サブファイル様式 → 1 件が占める行（項目の行の最小・最大）。
  const itemRows = new Map<string, { min: number; max: number }>();
  let current: string | undefined;

  for (const unit of units) {
    if (unit.kind === "record") {
      current = ddsName(unit.line).toUpperCase() || undefined;
      if (current !== undefined) {
        records.push({ name: current, sourceLine: unit.sourceLine, entries: parseKeywordEntries(unit.keywords) });
      }
      continue;
    }
    if (current === undefined) continue;
    const row = Number(ddsField(unit.line, DDS_POSITION_ROW).trim());
    if (!Number.isInteger(row) || row <= 0) continue;
    // 画面に出ない用途（H / P / M）は位置を持たない。空欄は 0 になり上で弾かれる。
    const span = itemRows.get(current);
    itemRows.set(current, span ? { min: Math.min(span.min, row), max: Math.max(span.max, row) } : { min: row, max: row });
  }

  const byName = new Map(records.map(record => [record.name, record]));
  const windows: DspfWindow[] = [];
  const windowOf = new Map<string, DspfWindow>();

  for (const record of records) {
    const window = readWindowDefinition(record);
    if (window === undefined) continue;
    windows.push(window);
    windowOf.set(record.name, window);
  }
  // 参照形: `WINDOW(様式名)`。定義している様式のウィンドウに入る。
  for (const record of records) {
    if (windowOf.has(record.name)) continue;
    const parameters = keywordParameters(record, "WINDOW")?.trim().toUpperCase();
    if (parameters === undefined || !/^[A-Z#@$][A-Z0-9#@$_]*$/u.test(parameters)) continue;
    const window = windowOf.get(parameters);
    if (window !== undefined) windowOf.set(record.name, window);
  }

  const subfileRepeat = new Map<string, SubfileRepeat>();
  for (const record of records) {
    const subfile = keywordParameters(record, "SFLCTL")?.trim().toUpperCase();
    if (subfile === undefined || !byName.has(subfile)) continue;
    // 制御様式がウィンドウに入れば、サブファイルも同じウィンドウに入る（原典の例 3）。
    const window = windowOf.get(record.name);
    if (window !== undefined && !windowOf.has(subfile)) windowOf.set(subfile, window);

    // `SFLLIN`（横に並べるサブファイル）は並べ方が別なので、縦には並べない。
    if (keywordParameters(record, "SFLLIN") !== undefined) continue;
    const page = Number(keywordParameters(record, "SFLPAG")?.trim());
    const span = itemRows.get(subfile);
    if (!Number.isInteger(page) || page <= 1 || span === undefined) continue;
    subfileRepeat.set(subfile, { count: page, rowStep: span.max - span.min + 1 });
  }

  const withRecords = windows.map(window => ({
    ...window,
    records: records.map(record => record.name).filter(name => windowOf.get(name) === window)
  }));
  const replaced = new Map(windows.map((window, index) => [window, withRecords[index]]));
  const resolvedOf = new Map([...windowOf].map(([name, window]) => [name, replaced.get(window) ?? window]));
  return { windows: withRecords, windowOf: resolvedOf, subfileRepeat };
}
