import { editorColumnOfMachineColumn } from "../../core/dbcs";

/**
 * 実機の桁で決まる欄（`sourceStart` から `length` 桁）の、エディタ上の範囲（1 始まり・終端を含まない）。
 *
 * 欄の桁は実機の桁（DBCS は SO/SI と全角 2 桁）なので、DBCS を含む行では文字の列とずれる。
 * 下線がずれた欄に引かれないよう、列に直してから返す。
 */
export function editorRange(
  line: string,
  sourceStart: number,
  length: number
): { startColumn: number; endColumn: number } {
  return {
    startColumn: editorColumnOfMachineColumn(line, sourceStart),
    endColumn: editorColumnOfMachineColumn(line, sourceStart + length)
  };
}
