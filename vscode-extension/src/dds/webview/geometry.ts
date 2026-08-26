/**
 * セル座標とピクセルの変換。**UI が持つ唯一の計算で、DOM に触らない。**
 *
 * ここにあるのは線形変換だけ——**文字に依存する計算は 1 つも無い**（それは core の仕事）。
 * DOM から切り離してあるのは、単体テストで固定できるようにするため。
 */

export interface CellMetrics {
  readonly cellWidth: number;
  readonly lineHeight: number;
}

export interface CanvasSize {
  readonly rows: number;
  readonly columns: number;
}

export interface CellPoint {
  readonly row: number;
  readonly column: number;
}

/** キャンバス左上からの相対座標を、セル位置（1 始まり）に直す。 */
export function cellFromOffset(
  offsetX: number,
  offsetY: number,
  metrics: CellMetrics,
  canvas: CanvasSize
): CellPoint {
  return {
    row: clamp(Math.floor(offsetY / metrics.lineHeight) + 1, 1, canvas.rows),
    column: clamp(Math.floor(offsetX / metrics.cellWidth) + 1, 1, canvas.columns)
  };
}

/**
 * ドラッグの移動量から移動先を求める。
 *
 * **右端は項目の幅ぶん余白を残す。** 画面外へ出す配置は診断が拾うが、
 * UI の側から不可能な位置を提示しない。
 */
export function movedTo(
  origin: CellPoint,
  deltaX: number,
  deltaY: number,
  widthCols: number,
  metrics: CellMetrics,
  canvas: CanvasSize
): CellPoint {
  const maxColumn = Math.max(1, canvas.columns - widthCols + 1);
  return {
    row: clamp(origin.row + Math.round(deltaY / metrics.lineHeight), 1, canvas.rows),
    column: clamp(origin.column + Math.round(deltaX / metrics.cellWidth), 1, maxColumn)
  };
}

/** つまみの移動量から、変更後の桁数を求める。 */
export function resizedTo(
  originWidth: number,
  originColumn: number,
  deltaX: number,
  metrics: CellMetrics,
  canvas: CanvasSize
): number {
  const maxWidth = Math.max(1, canvas.columns - originColumn + 1);
  return clamp(originWidth + Math.round(deltaX / metrics.cellWidth), 1, maxWidth);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
