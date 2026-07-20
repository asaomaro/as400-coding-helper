import { DDS_COLUMNS, type DdsColumn } from "../ddsLayout";

/**
 * 印刷装置ファイルの位置欄の内訳。
 *
 * 原典（`位置 (印刷装置ファイルの 39 から 44 桁目)`）:
 * > 39 から 41 桁目には**行**、42 から 44 桁目には**位置**を指定します。
 *
 * ■ なぜ `DDS_COLUMNS` に足さないか
 *   `DDS_COLUMNS` は**ルーラーのタブ位置と共有する桁定義**で、生成物
 *   （`resources/navigation/dds-keyword-columns.json`）と一致していることを
 *   `contributesSideEffects.test.ts` が検査している。生成物は位置欄を
 *   39-44 の 1 欄として持つので、42 はタブ位置に**存在しない**。
 *   そこに足すと検査が落ちる（実際に落ちた）。
 *
 *   行と桁の分割は「ルーラーが止まる場所」ではなく **PRTF 固有の読み方**なので、
 *   共有定義から**導出**する形にしてここに置く。基準の桁は 1 か所のまま。
 */

const [POSITION_START, POSITION_END] = DDS_COLUMNS.position;

/** 39-41 桁。ページ上の行。 */
export const PRTF_POSITION_ROW: DdsColumn = [POSITION_START, POSITION_START + 2];

/** 42-44 桁。ページ上の桁。 */
export const PRTF_POSITION_COLUMN: DdsColumn = [POSITION_START + 3, POSITION_END];
