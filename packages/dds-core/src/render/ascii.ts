/**
 * 様式を ASCII のグリッドとして描画する。
 *
 * ## 出力の形は実機に合わせてある（実測で確定）
 *
 * ts5250 の `get_screen` が返すグリッドを実測した結果に合わせている:
 *
 * | 事実 | 内容 |
 * |---|---|
 * | 行の長さ | **各行きっかり `cols` 個の JS 文字** |
 * | 全角文字 | **1 文字ぶんのセルを占め、次のセルは空白**（2 表示桁を「文字＋空白」で表す） |
 * | SO / SI | **空白**（可視文字にならない） |
 * | 属性バイト | **空白** |
 *
 * **形式を自分で決めていない**のが要点。自分で決めると「レンダラの出力とゴールデンを
 * 揃える変換」がもう 1 段必要になり、そこがバグの温床になる。
 *
 * ## 同じ配置計算を GUI も使う
 *
 * ゴールデンで検証されるのはこの ASCII 出力だが、GUI 向けの `RenderModel` も
 * **同じ配置計算（`render/layout`）を通る**。したがって **AC5 / AC6 の検証は GUI の配置にも効く**。
 * このモジュールに残っているのは「セル列をグリッドへ書き、桁方向にはみ出した分を切る」ことだけ。
 */

import type { DdsDoc } from "../dds/model.js";
import { DEFAULT_SCREEN, type ScreenSize } from "../dds/validate.js";
import { placements } from "./layout.js";

/** 描画の指定。 */
export interface RenderOptions {
  /**
   * 描画するレコード様式。
   *
   * **省略すると最初の様式を描く。** DSPF は複数の様式が同じ領域を使うのが普通なので、
   * すべてを重ねると潰れて「どちらの内容か分からない絵」になる。
   * それを既定にすると、`--record` を付け忘れた利用者が黙って無意味な出力を受け取る。
   */
  readonly record?: string;
  /**
   * すべての様式を重ねて描く（確認用）。
   *
   * requirement で決めた「重ね合わせは確認用・編集はアクティブ様式のみ」に対応する。
   * **明示的に指定したときだけ**重ねる。
   */
  readonly allRecords?: boolean;
  /** 画面の大きさ。既定は 24×80。 */
  readonly screen?: ScreenSize;
}

/**
 * 様式を ASCII で描画する。
 *
 * 返す文字列は `screen.rows` 行で、**各行はきっかり `screen.cols` 個の JS 文字**。
 * 行は改行で連結し、末尾にも改行を付ける（ゴールデンと同じ形）。
 */
export function renderAscii(doc: DdsDoc, options: RenderOptions = {}): string {
  const screen = options.screen ?? DEFAULT_SCREEN;

  // グリッドはセルの二次元配列。1 セル = 1 表示桁。
  const grid: string[][] = Array.from({ length: screen.rows }, () =>
    new Array<string>(screen.cols).fill(" ")
  );

  for (const placement of placements(doc, {
    record: options.record,
    allRecords: options.allRecords,
    screen
  })) {
    const row = grid[placement.line - 1];
    placement.cells.forEach((cell, offset) => {
      const col = placement.pos + offset;
      if (col >= 1 && col <= screen.cols) {
        row[col - 1] = cell;
      }
    });
  }

  return grid.map(row => row.join("")).join("\n") + "\n";
}
