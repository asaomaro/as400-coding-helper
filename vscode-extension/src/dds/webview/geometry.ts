/**
 * セル座標 ⇄ ピクセルの変換。**UI の中で唯一「数える」層で、DOM に触らない。**
 *
 * design DD3 のとおり、WebView が持ってよい計算はここにある線形変換だけ。
 * **文字に依存する計算（表示桁・DBCS の幅）は 1 つも無い**——それは core の仕事。
 *
 * DOM から切り離してあるのは、拡張の統合テストが CI に載らないため
 * （親 plan「CI に載せるもの / 載せないもの」）。**ここを純関数にしておけば単体で守れる。**
 */

/** キャンバスの大きさ（セル数）。 */
export interface CanvasSize {
  readonly rows: number;
  readonly cols: number;
}

/** セルの実寸（px）。起動時に実測した値（design DD2）。 */
export interface CellMetrics {
  readonly cellW: number;
  readonly cellH: number;
}

/** 画面上の位置（1 始まり）。 */
export interface CellPoint {
  readonly line: number;
  readonly pos: number;
}

/** キャンバス左上からの相対座標を、セル位置に直す。 */
export function cellFromOffset(
  offsetX: number,
  offsetY: number,
  metrics: CellMetrics,
  canvas: CanvasSize
): CellPoint {
  return {
    line: clamp(Math.floor(offsetY / metrics.cellH) + 1, 1, canvas.rows),
    pos: clamp(Math.floor(offsetX / metrics.cellW) + 1, 1, canvas.cols)
  };
}

/**
 * ドラッグの移動量から、移動先のセル位置を求める。
 *
 * **右端をはみ出さないように桁を丸める。** アイテムの幅ぶんだけ余白を残す——
 * 画面外へ出す操作は core が検証違反として弾くが、UI の側で不可能な位置を提示しない。
 */
export function movedTo(
  origin: CellPoint,
  dx: number,
  dy: number,
  widthCols: number,
  metrics: CellMetrics,
  canvas: CanvasSize
): CellPoint {
  const maxPos = Math.max(1, canvas.cols - widthCols + 1);
  return {
    line: clamp(origin.line + Math.round(dy / metrics.cellH), 1, canvas.rows),
    pos: clamp(origin.pos + Math.round(dx / metrics.cellW), 1, maxPos)
  };
}

/** リサイズの移動量から、変更後の幅（表示桁数）を求める。 */
export function resizedTo(
  originWidth: number,
  originPos: number,
  dx: number,
  metrics: CellMetrics,
  canvas: CanvasSize
): number {
  const maxWidth = Math.max(1, canvas.cols - originPos + 1);
  return clamp(originWidth + Math.round(dx / metrics.cellW), 1, maxWidth);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
