/**
 * モデル → テキストの書き戻しと、行の局所書き換え。
 *
 * ## `serialize` は「単なる連結」である（意図的）
 *
 * 整形・正規化・空白の詰めを**一切しない**。これにより
 * 「編集していない行はバイト不変」（requirement AC2）が、実装の注意深さではなく
 * **構造**で保証される。
 *
 * **ここに「気を利かせる」処理を足してはならない。** 足した瞬間に AC2 の保証が崩れる。
 *
 * ## 行の書き換えは `rewriteLine` が担う
 *
 * 「どこを書き換えるか」の知識をこの関数に閉じ込め、`patch/ops` はこれを呼ぶだけにする。
 * 指定した桁範囲**以外は 1 文字も変えない**。
 */

import type { DdsDoc } from "./model.js";
import {
  displayWidth,
  sourceColumnToCharIndex
} from "../text/encoding.js";

const UTF8_BOM = "﻿";

/**
 * モデルをテキストへ戻す。
 *
 * `raw` を連結し、改行・BOM・最終行の改行有無を元どおりに復元するだけ。
 */
export function serialize(doc: DdsDoc): string {
  const body = doc.lines.map(line => line.raw).join(doc.eol);
  const withNewline = doc.finalNewline ? body + doc.eol : body;
  return doc.bom ? UTF8_BOM + withNewline : withNewline;
}

/** 1 か所の桁範囲の差し替え指示。 */
export interface ColumnChange {
  /** 差し替え開始桁（1 始まり）。 */
  readonly col: number;
  /** 差し替える桁数。 */
  readonly width: number;
  /** 差し替える内容。**表示桁数が `width` と一致していなければならない。** */
  readonly text: string;
}

/**
 * 行の指定桁範囲だけを差し替える。
 *
 * - 指定範囲**以外は 1 文字も変えない**。
 * - 行が短ければ空白で埋めてから差し替える。
 * - **`lineWidth` を超える変更は拒否する**（元が 80 桁なら 80 桁のまま。spec のエッジケース）。
 * - 差し替え内容の表示桁数が `width` と違えば拒否する（桁がずれるため）。
 * - 範囲の境界が DBCS 文字や SO/SI を跨ぐ場合は拒否する（**黙って丸めない**）。
 *
 * @throws RangeError 上記の拒否条件に当たった場合
 */
export function rewriteLine(
  raw: string,
  changes: readonly ColumnChange[],
  lineWidth: number
): string {
  let out = raw;

  // 右の変更から順に適用する。左から適用すると、幅が変わったときに
  // 後続の桁位置がずれる（実際には幅は変わらないが、順序に依存しない形にしておく）。
  const ordered = [...changes].sort((a, b) => b.col - a.col);

  for (const change of ordered) {
    if (!Number.isInteger(change.col) || change.col < 1) {
      throw new RangeError(`桁は 1 始まりの整数です: ${change.col}`);
    }
    if (!Number.isInteger(change.width) || change.width < 1) {
      throw new RangeError(`桁数は 1 以上の整数です: ${change.width}`);
    }

    const endCol = change.col + change.width - 1;
    if (endCol > lineWidth) {
      throw new RangeError(
        `行幅 ${lineWidth} 桁を超える変更です: ${change.col}〜${endCol} 桁`
      );
    }

    const textWidth = displayWidth(change.text);
    if (textWidth !== change.width) {
      throw new RangeError(
        `差し替え内容の表示桁数が一致しません: ` +
          `${JSON.stringify(change.text)} は ${textWidth} 桁、指定は ${change.width} 桁`
      );
    }

    // 差し替え位置まで空白で埋める（末尾が短い行への変更に備える）。
    let padded = out;
    while (displayWidth(padded) < endCol) {
      padded += " ";
    }

    const from = sourceColumnToCharIndex(padded, change.col);
    if (from.straddles) {
      throw new RangeError(
        `${change.col} 桁は文字の途中（DBCS の 2 桁目 / SO / SI）を指しています`
      );
    }

    const to = sourceColumnToCharIndex(padded, endCol + 1);
    if (to.straddles) {
      throw new RangeError(
        `${endCol} 桁で文字が分断されます（DBCS の途中で切れています）`
      );
    }

    out = padded.slice(0, from.index) + change.text + padded.slice(to.index);
  }

  return out;
}
