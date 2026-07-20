import { DDS_COLUMNS, type DdsColumn } from "../ddsLayout";

/**
 * 位置欄（39-44 桁）の内訳。**印刷装置・表示装置に共通**。
 *
 * 原典（`位置 (印刷装置ファイルの 39 から 44 桁目)`）:
 * > 39 から 41 桁目には**行**、42 から 44 桁目には**位置**を指定します。
 *
 * 原典（`表示装置ファイルの位置 (39 - 44 桁目)`）:
 * > **行 (39 - 41 桁目)** … フィールドが始まる行を指定します。
 * > **桁 (42 - 44 桁目)** … 指定した行の中でのフィールドの開始桁を指定します。
 *
 * 桁の意味が同じなので、PRTF と DSPF で同じ定義を使う。
 *
 * ■ なぜ `DDS_COLUMNS` に足さないか
 *   `DDS_COLUMNS` は**ルーラーのタブ位置と共有する桁定義**で、生成物
 *   （`resources/navigation/dds-keyword-columns.json`）と一致していることを
 *   `contributesSideEffects.test.ts` が検査している。生成物は位置欄を
 *   39-44 の 1 欄として持つので、42 はタブ位置に**存在しない**。
 *   そこに足すと検査が落ちる（実際に落ちた）。
 *
 *   行と桁の分割は「ルーラーが止まる場所」ではなく **DDS の読み方**なので、
 *   共有定義から**導出**する形にしてここに置く。基準の桁は 1 か所のまま。
 */

const [POSITION_START, POSITION_END] = DDS_COLUMNS.position;

/** 39-41 桁。ページ／画面上の行。 */
export const DDS_POSITION_ROW: DdsColumn = [POSITION_START, POSITION_START + 2];

/** 42-44 桁。ページ／画面上の桁。 */
export const DDS_POSITION_COLUMN: DdsColumn = [POSITION_START + 3, POSITION_END];
