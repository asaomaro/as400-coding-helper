/**
 * dds-core — DDS(DSPF/PRTF) のパーサ / モデル / シリアライザ / レンダラ。
 *
 * **このパッケージは vscode に依存してはならない**（requirement AC9）。
 * 人間向けの GUI・CLI・将来の MCP は、いずれもこのパッケージを利用者として使う。
 * 判断（表示桁換算・検証・条件評価）はすべてここに置き、利用者側は「描く」「繋ぐ」だけにする。
 *
 * 境界の守り方は tsconfig.json のコメントを参照。
 */

/** パッケージ版数（骨格段階のプレースホルダ）。 */
export const DDS_CORE_VERSION = "0.0.0";

export {
  isDbcsCodePoint,
  displayWidth,
  charIndexToColumn,
  columnToCharIndex,
  sosiPositions,
  charIndexToSourceColumn,
  sourceColumnToCharIndex
} from "./text/encoding.js";

export type { ColumnLookup, SosiPositions } from "./text/encoding.js";

export {
  parse,
  parseBytes
} from "./dds/parse.js";

export { serialize, rewriteLine } from "./dds/serialize.js";

export {
  DDS_COLUMNS,
  DEFAULT_LINE_WIDTH,
  sliceColumns,
  fieldAt,
  numberAt,
  literalFromFunctions
} from "./dds/lineLayout.js";

export { decodeSource } from "./text/decode.js";

export type {
  DdsDoc,
  DdsLine,
  DdsItem,
  DdsRecord,
  OpaqueLine,
  RecordLine,
  ItemLine,
  Eol
} from "./dds/model.js";

export type { ParseOptions } from "./dds/parse.js";
export type { ColumnChange } from "./dds/serialize.js";
export type { ColumnRange } from "./dds/lineLayout.js";
export type { SourceEncoding, DecodeResult } from "./text/decode.js";

export {
  validate,
  hasError,
  itemWidth,
  itemContentWidth,
  signPositions,
  effectiveDataType,
  isNumericField,
  DIAGNOSTIC_CODES,
  DEFAULT_SCREEN
} from "./dds/validate.js";

export { applyOps, PatchRejectedError } from "./patch/ops.js";

export type {
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticCode,
  ScreenSize
} from "./dds/validate.js";

export type {
  PatchOp,
  MoveItemOp,
  ResizeItemOp,
  AddItemOp,
  RemoveItemOp,
  NewItem,
  ApplyResult,
  ChangedLines
} from "./patch/ops.js";

export { renderAscii } from "./render/ascii.js";
export type { RenderOptions } from "./render/ascii.js";

export {
  placements,
  placementOf,
  ALPHA_PLACEHOLDER,
  NUMERIC_PLACEHOLDER
} from "./render/layout.js";

export type { Placement, PlacementOptions, Segment } from "./render/layout.js";

export { buildRenderModel } from "./render/model.js";

export type {
  RenderModel,
  RenderCanvas,
  RenderRecord,
  RenderItem,
  RenderDiagnostic,
  RenderModelOptions
} from "./render/model.js";
