import { ddsName } from "../ddsLayout";
import { resolveKeywordGroups, type Conditioning } from "./ddsConditioning";
import { parseKeywordEntries } from "./ddsKeywords";
import { fileLevelKeywordLines, type LogicalUnit } from "./ddsLogicalUnits";
import { matchesScreenSize, type ScreenSizeEntry } from "./dspfScreenSize";

/**
 * 画面の**罫線**（`GRDBOX` / `GRDLIN`）を、描ける線分に直す。**vscode を import しない。**
 *
 * 線は文字の枠の上に引かれる（原典 `GRDRCD`: 「文字ボックスの上部横線・下部横線・左縦線・右縦線」）。
 * そこで線分の位置は**桁・行の境目**で表す。横線の `at` は「何行目の下の境目か」（0 が 1 行目の上）、
 * 縦線の `at` は「何桁目の右の境目か」（0 が 1 桁目の左）。`from` / `to` も同じ数え方。
 *
 * ## 原典（`docs/origin/dds/detail/rzakc_rzakcmstdfgrd*.htm`）
 *
 * - `GRDBOX((*POS (開始行 開始桁 深さ 幅)) (*TYPE 形 [横の罫線] [縦の罫線]) (*COLOR) (*LINTYP))`。
 *   形は `PLAIN`（既定）/ `HRZ` / `VRT` / `HRZVRT`。罫線の値は「各罫線間の文字スペースの数」で、
 *   「*TYPE VRT ボックスが 21 桁の幅および 3 桁の罫線値で定義される場合、ボックスには 6 つの縦線」。
 * - `GRDLIN((*POS (開始行 開始桁 長さ)) (*TYPE UPPER|LOWER|RIGHT|LEFT [反復] [間隔]) …)`。
 *   `UPPER`（既定）/`LOWER` は横線、`RIGHT`/`LEFT` は縦線。例: `*POS (4 6 20)` の `RIGHT 4 15` は
 *   「4 つの縦線が桁 6、21、36、および 51 の文字の右境界線に描かれます。各線は 20 行の長さ」。
 * - `*POS` の中の `*DS3` / `*DS4` は画面サイズごとの値。
 * - 色と線種は「GRDBOX または GRDLIN キーワードで定義される属性は、ファイル・レベルまたは
 *   レコード・レベルの GRDATR キーワードを上書き」。既定は白・実線（`GRDATR` の注）。
 *   `NONE` は「GRDATR キーワードによって設定される色が使用されます」。
 *
 * **P フィールド（`&名前`）で決まる位置・大きさは描かない**（実行時に決まる）。色・線種が P フィールドなら既定で描く。
 */
export type GridColor =
  | "BLU" | "GRN" | "CYAN" | "RED" | "VLT" | "YLW" | "WHT" | "GRY"
  | "LBLU" | "LGRN" | "LTRQ" | "LRED" | "LVLT" | "LYLW" | "HWHT" | "BLK";
export type GridLineType = "SLD" | "THK" | "DBL" | "DOT" | "DSH" | "THKDSH" | "DBLDSH";

const COLORS: ReadonlySet<string> = new Set([
  "BLU", "GRN", "CYAN", "RED", "VLT", "YLW", "WHT", "GRY",
  "LBLU", "LGRN", "LTRQ", "LRED", "LVLT", "LYLW", "HWHT", "BLK"
]);
const LINE_TYPES: ReadonlySet<string> = new Set(["SLD", "THK", "DBL", "DOT", "DSH", "THKDSH", "DBLDSH"]);

export interface GridLine {
  readonly orientation: "horizontal" | "vertical";
  /** 横線なら行の境目（0 = 1 行目の上）、縦線なら桁の境目（0 = 1 桁目の左）。 */
  readonly at: number;
  /** 線の範囲（横線は桁の境目、縦線は行の境目）。 */
  readonly from: number;
  readonly to: number;
  readonly color: GridColor;
  readonly lineType: GridLineType;
  readonly recordName: string;
  /** キーワードが書かれている行（1 始まり）。 */
  readonly sourceLine: number;
  /** キーワードの条件（オプション標識）。 */
  readonly condition: Conditioning;
}

/** 線分の形（色・出どころを付ける前）。 */
type Segment = Pick<GridLine, "orientation" | "at" | "from" | "to">;

/** 括弧の入れ子を読む。語は大文字にする。 */
type Node = string | Node[];

function parseNodes(text: string): Node[] {
  const root: Node[] = [];
  const stack: Node[][] = [root];
  for (const token of text.toUpperCase().match(/[()]|[^\s()]+/gu) ?? []) {
    if (token === "(") {
      const child: Node[] = [];
      stack[stack.length - 1].push(child);
      stack.push(child);
    } else if (token === ")") {
      if (stack.length > 1) stack.pop();
    } else {
      stack[stack.length - 1].push(token);
    }
  }
  return root;
}

/** `(*POS …)` / `(*TYPE …)` のように先頭が名前の組を引く。 */
function option(nodes: readonly Node[], name: string): Node[] | undefined {
  for (const node of nodes) {
    if (Array.isArray(node) && node[0] === name) return node.slice(1);
  }
  return undefined;
}

const NUMBER = /^\d+$/u;

/** `*POS` の数値。`*DS3` / `*DS4` の組があれば対象の画面サイズのものを採る。P フィールドなら undefined。 */
function readPosition(position: readonly Node[] | undefined, count: number, size: ScreenSizeEntry): number[] | undefined {
  if (position === undefined) return undefined;
  const candidates = position.every(node => typeof node === "string") ? [position] : position.filter(Array.isArray);
  for (const candidate of candidates) {
    const words = (candidate as Node[]).filter((node): node is string => typeof node === "string");
    const named = words[0]?.startsWith("*") ? words[0] : undefined;
    if (named !== undefined && !matchesScreenSize(named, size)) continue;
    const values = named === undefined ? words : words.slice(1);
    if (values.length !== count || !values.every(value => NUMBER.test(value))) return undefined;
    return values.map(Number);
  }
  return undefined;
}

interface Attributes {
  readonly color: GridColor;
  readonly lineType: GridLineType;
}

const DEFAULT_ATTRIBUTES: Attributes = { color: "WHT", lineType: "SLD" };

/** `(*COLOR x)` / `(*LINTYP x)` を既定の上に重ねる。`NONE` と P フィールドは既定のまま。 */
function overlay(base: Attributes, nodes: readonly Node[]): Attributes {
  // 原典の例には `*` の無い `(LINTYP SLD)` もある（`GRDATR` の例）。どちらも読む。
  const color = (option(nodes, "*COLOR") ?? option(nodes, "COLOR"))?.[0];
  const lineType = (option(nodes, "*LINTYP") ?? option(nodes, "LINTYP"))?.[0];
  return {
    color: typeof color === "string" && COLORS.has(color) ? (color as GridColor) : base.color,
    lineType: typeof lineType === "string" && LINE_TYPES.has(lineType) ? (lineType as GridLineType) : base.lineType
  };
}

function gridAttributes(keywords: string, base: Attributes): Attributes {
  let result = base;
  for (const entry of parseKeywordEntries(keywords)) {
    if (entry.kind === "keyword" && entry.name === "GRDATR" && entry.parameters !== undefined) {
      result = overlay(result, parseNodes(entry.parameters));
    }
  }
  return result;
}

function boxLines(values: readonly number[], type: readonly Node[] | undefined): Segment[] {
  const [row, column, depth, width] = values;
  const top = row - 1;
  const bottom = top + depth;
  const left = column - 1;
  const right = left + width;
  const lines: Segment[] = [
    { orientation: "horizontal", at: top, from: left, to: right },
    { orientation: "horizontal", at: bottom, from: left, to: right },
    { orientation: "vertical", at: left, from: top, to: bottom },
    { orientation: "vertical", at: right, from: top, to: bottom }
  ];
  const kind = typeof type?.[0] === "string" ? type[0] : "PLAIN";
  const rules = (type ?? []).slice(1).map(node => (typeof node === "string" && NUMBER.test(node) ? Number(node) : undefined));
  const horizontalRule = kind === "HRZ" || kind === "HRZVRT" ? rules[0] : undefined;
  const verticalRule = kind === "VRT" ? rules[0] : kind === "HRZVRT" ? rules[1] : undefined;
  if (horizontalRule !== undefined && horizontalRule > 0) {
    for (let at = top + horizontalRule; at < bottom; at += horizontalRule) {
      lines.push({ orientation: "horizontal", at, from: left, to: right });
    }
  }
  if (verticalRule !== undefined && verticalRule > 0) {
    for (let at = left + verticalRule; at < right; at += verticalRule) {
      lines.push({ orientation: "vertical", at, from: top, to: bottom });
    }
  }
  return lines;
}

function lineLines(values: readonly number[], type: readonly Node[] | undefined): Segment[] {
  const [row, column, length] = values;
  const kind = typeof type?.[0] === "string" ? type[0] : "UPPER";
  const numbers = (type ?? []).slice(1).map(node => (typeof node === "string" && NUMBER.test(node) ? Number(node) : undefined));
  // 反復・間隔の既定は 1（原典）。P フィールドなら 1 本だけ描く。
  const repeat = numbers[0] ?? 1;
  const interval = numbers[1] ?? 1;
  const lines: Segment[] = [];
  for (let index = 0; index < Math.max(1, repeat); index += 1) {
    const shift = index * interval;
    if (kind === "UPPER" || kind === "LOWER") {
      lines.push({
        orientation: "horizontal",
        at: (kind === "UPPER" ? row - 1 : row) + shift,
        from: column - 1,
        to: column - 1 + length
      });
    } else if (kind === "RIGHT" || kind === "LEFT") {
      lines.push({
        orientation: "vertical",
        at: (kind === "LEFT" ? column - 1 : column) + shift,
        from: row - 1,
        to: row - 1 + length
      });
    }
  }
  return lines;
}

/** 箱か線か、と位置・大きさ・形（キーワードの `*POS` と `*TYPE`）。 */
export type GridGeometry =
  | {
      readonly kind: "box";
      readonly row: number;
      readonly column: number;
      readonly depth: number;
      readonly width: number;
      readonly type: GridBoxType;
      /** 横の罫線の間隔（`HRZ` / `HRZVRT`）。 */
      readonly horizontalRule?: number;
      /** 縦の罫線の間隔（`VRT` / `HRZVRT`）。 */
      readonly verticalRule?: number;
    }
  | {
      readonly kind: "line";
      readonly row: number;
      readonly column: number;
      readonly length: number;
      readonly type: GridLineKind;
      readonly repeat?: number;
      readonly interval?: number;
    };
export type GridBoxType = "PLAIN" | "HRZ" | "VRT" | "HRZVRT";
export type GridLineKind = "UPPER" | "LOWER" | "LEFT" | "RIGHT";

/**
 * 罫線のキーワード 1 つ（`GRDBOX` / `GRDLIN`）。**選ぶ・動かす・消すの単位**。
 *
 * 宛先は「様式の宣言行」と「その様式のキーワード欄を全部の行を通して区切ったときの何番目か」
 * （`ddsEdit` の `locateKeyword`、キーワードのチップと同じ数え方）。
 */
export interface GridShape {
  /** UI で使う識別子（`様式の行:番目`）。 */
  readonly key: string;
  readonly recordName: string;
  /** 様式の宣言行（1 始まり）。 */
  readonly recordLine: number;
  readonly index: number;
  /** キーワードが書かれている行（1 始まり）。 */
  readonly sourceLine: number;
  readonly condition: Conditioning;
  readonly geometry: GridGeometry;
  /** キーワードそのものに書かれた色・線種（無ければ GRDATR・既定が効く）。 */
  readonly writtenColor?: GridColor;
  readonly writtenLineType?: GridLineType;
  /** 効いている色・線種。 */
  readonly color: GridColor;
  readonly lineType: GridLineType;
  /** キーワードの生テキスト（`GRDBOX(...)`）。書き換えはこれを元にする。 */
  readonly raw: string;
  readonly lines: readonly GridLine[];
}

function readGeometry(isBox: boolean, values: readonly number[], type: readonly Node[] | undefined): GridGeometry | undefined {
  const words = (type ?? []).map(node => (typeof node === "string" ? node : ""));
  const numbers = words.slice(1).map(word => (NUMBER.test(word) ? Number(word) : undefined));
  if (isBox) {
    const [row, column, depth, width] = values;
    const kind = (words[0] || "PLAIN") as GridBoxType;
    if (!["PLAIN", "HRZ", "VRT", "HRZVRT"].includes(kind)) return undefined;
    return {
      kind: "box", row, column, depth, width, type: kind,
      ...(kind === "HRZ" || kind === "HRZVRT" ? (numbers[0] !== undefined ? { horizontalRule: numbers[0] } : {}) : {}),
      ...(kind === "VRT" && numbers[0] !== undefined ? { verticalRule: numbers[0] } : {}),
      ...(kind === "HRZVRT" && numbers[1] !== undefined ? { verticalRule: numbers[1] } : {})
    };
  }
  const [row, column, length] = values;
  const kind = (words[0] || "UPPER") as GridLineKind;
  if (!["UPPER", "LOWER", "LEFT", "RIGHT"].includes(kind)) return undefined;
  return {
    kind: "line", row, column, length, type: kind,
    ...(numbers[0] !== undefined ? { repeat: numbers[0] } : {}),
    ...(numbers[1] !== undefined ? { interval: numbers[1] } : {})
  };
}

/** 画面の罫線をキーワードごとに解く。 */
export function resolveGridShapes(
  lines: readonly string[],
  units: readonly LogicalUnit[],
  size: ScreenSizeEntry
): GridShape[] {
  const fileAttributes = fileLevelKeywordLines(lines).reduce(
    (base, entry) => gridAttributes(entry.keywords, base),
    DEFAULT_ATTRIBUTES
  );
  const result: GridShape[] = [];

  for (const unit of units) {
    if (unit.kind !== "record") continue;
    if (!/\bGRD(?:BOX|LIN)\b/iu.test(unit.keywords)) continue;
    const recordName = ddsName(unit.line);
    const recordAttributes = gridAttributes(unit.keywords, fileAttributes);
    let offset = 0;

    for (const group of resolveKeywordGroups(unit)) {
      const entries = parseKeywordEntries(group.keywords);
      const groupOffset = offset;
      offset += entries.length;
      if (group.conditioning.kind === "screen-size" && !matchesScreenSize(group.conditioning.name, size)) continue;
      entries.forEach((entry, at) => {
        if (entry.kind !== "keyword" || entry.parameters === undefined) return;
        if (entry.name !== "GRDBOX" && entry.name !== "GRDLIN") return;
        const nodes = parseNodes(entry.parameters);
        const isBox = entry.name === "GRDBOX";
        const values = readPosition(option(nodes, "*POS"), isBox ? 4 : 3, size);
        if (values === undefined) return;
        const type = option(nodes, "*TYPE");
        const geometry = readGeometry(isBox, values, type);
        if (geometry === undefined) return;
        const attributes = overlay(recordAttributes, nodes);
        const written = overlay({ color: "" as GridColor, lineType: "" as GridLineType }, nodes);
        const index = groupOffset + at;
        result.push({
          key: `${unit.sourceLine}:${index}`,
          recordName,
          recordLine: unit.sourceLine,
          index,
          sourceLine: group.sourceLine,
          condition: group.conditioning,
          geometry,
          ...(written.color ? { writtenColor: written.color } : {}),
          ...(written.lineType ? { writtenLineType: written.lineType } : {}),
          ...attributes,
          raw: entry.raw,
          lines: (isBox ? boxLines(values, type) : lineLines(values, type)).map(segment => ({
            ...segment,
            ...attributes,
            recordName,
            sourceLine: group.sourceLine,
            condition: group.conditioning
          }))
        });
      });
    }
  }
  return result;
}

/** 画面の罫線を解く（線分だけ）。 */
export function resolveGridLines(
  lines: readonly string[],
  units: readonly LogicalUnit[],
  size: ScreenSizeEntry
): GridLine[] {
  return resolveGridShapes(lines, units, size).flatMap(shape => shape.lines);
}

/** 色・線種の指定。`undefined` は書かない（GRDATR・既定に任せる）。 */
export interface GridStyle {
  readonly color?: GridColor;
  readonly lineType?: GridLineType;
}

function geometryNodes(geometry: GridGeometry): { position: string; type: string } {
  if (geometry.kind === "box") {
    const rules =
      geometry.type === "HRZ" ? [geometry.horizontalRule ?? 1]
        : geometry.type === "VRT" ? [geometry.verticalRule ?? 1]
          : geometry.type === "HRZVRT" ? [geometry.horizontalRule ?? 1, geometry.verticalRule ?? 1]
            : [];
    return {
      position: `${geometry.row} ${geometry.column} ${geometry.depth} ${geometry.width}`,
      type: [geometry.type, ...rules].join(" ")
    };
  }
  const extra = geometry.repeat !== undefined && geometry.repeat > 1 ? [geometry.repeat, geometry.interval ?? 1] : [];
  return {
    position: `${geometry.row} ${geometry.column} ${geometry.length}`,
    type: [geometry.type, ...extra].join(" ")
  };
}

/**
 * 新しい罫線のキーワードを作る。`*TYPE` は原典で必須なので常に書く。
 *
 * `GRDBOX((*POS (5 2 10 60)) (*TYPE PLAIN))` / `GRDLIN((*POS (8 2 60)) (*TYPE LOWER) (*COLOR RED))`
 */
export function buildGridKeyword(geometry: GridGeometry, style: GridStyle = {}): string {
  const { position, type } = geometryNodes(geometry);
  const parts = [`(*POS (${position}))`, `(*TYPE ${type})`];
  if (style.color !== undefined) parts.push(`(*COLOR ${style.color})`);
  if (style.lineType !== undefined) parts.push(`(*LINTYP ${style.lineType})`);
  return `${geometry.kind === "box" ? "GRDBOX" : "GRDLIN"}(${parts.join(" ")})`;
}

function serialize(node: Node): string {
  return typeof node === "string" ? node : `(${node.map(serialize).join(" ")})`;
}

/**
 * 既存の罫線のキーワードを書き換える。**触らない指定は残す**（`*CONTROL &CNTL1` など）。
 *
 * `*POS` が `*DS3` / `*DS4` で分かれているなら、描いている画面サイズの組だけ書き換える。
 * 色・線種は `style` に**鍵があれば**書き換え（値が `undefined` なら外す）、鍵が無ければ触らない。
 */
export function rewriteGridKeyword(
  raw: string,
  geometry: GridGeometry,
  size: ScreenSizeEntry,
  style: { color?: GridColor | undefined; lineType?: GridLineType | undefined } = {}
): string {
  const entry = parseKeywordEntries(raw)[0];
  const name = entry?.name === "GRDLIN" ? "GRDLIN" : "GRDBOX";
  const nodes = parseNodes(entry?.parameters ?? "");
  const { position, type } = geometryNodes(geometry);
  const numbers = position.split(" ");

  const positionAt = nodes.findIndex(node => Array.isArray(node) && node[0] === "*POS");
  const current = positionAt >= 0 ? (nodes[positionAt] as Node[]).slice(1) : [];
  const named = current.filter(Array.isArray).filter(group => typeof group[0] === "string" && group[0].startsWith("*"));
  const target = named.find(group => matchesScreenSize(group[0] as string, size));
  const newPosition: Node[] = target !== undefined
    ? ["*POS", ...current.map(group => (group === target ? [target[0], ...numbers] : group))]
    : ["*POS", numbers];
  if (positionAt >= 0) nodes[positionAt] = newPosition;
  else nodes.unshift(newPosition);

  const replace = (key: string, value: string | undefined, present: boolean) => {
    if (!present) return;
    const at = nodes.findIndex(node => Array.isArray(node) && (node[0] === key || node[0] === key.slice(1)));
    if (value === undefined) {
      if (at >= 0) nodes.splice(at, 1);
      return;
    }
    const next: Node[] = [key, ...value.split(" ")];
    if (at >= 0) nodes[at] = next;
    else nodes.push(next);
  };
  replace("*TYPE", type, true);
  replace("*COLOR", style.color, "color" in style);
  replace("*LINTYP", style.lineType, "lineType" in style);
  return `${name}(${nodes.map(serialize).join(" ")})`;
}

/** 選んだ 2 つの桁（1 始まり・両端を含む）から、引く罫線の形を決める（利用者の決定: 形で自動判定）。 */
export function geometryFromCells(
  from: { row: number; column: number },
  to: { row: number; column: number }
): GridGeometry {
  const row = Math.min(from.row, to.row);
  const column = Math.min(from.column, to.column);
  const depth = Math.abs(from.row - to.row) + 1;
  const width = Math.abs(from.column - to.column) + 1;
  if (depth === 1) return { kind: "line", row, column, length: width, type: "LOWER" };
  if (width === 1) return { kind: "line", row, column, length: depth, type: "RIGHT" };
  return { kind: "box", row, column, depth, width, type: "PLAIN" };
}
