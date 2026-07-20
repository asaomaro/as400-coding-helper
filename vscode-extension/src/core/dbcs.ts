/**
 * DBCS（全角）の判定と、**実機での印刷桁数**の計算。
 *
 * このモジュールは **vscode を import しない**。SOSI 表示（`dbcsShiftMarkers`）と
 * 帳票プレビュー（`dds/prtfLayout`）が同じ判定を使うために置いている。
 * 片方だけ直すと「ルーラーでは合っているのにプレビューがずれる」が起きる。
 */

/**
 * その符号位置を DBCS（全角）とみなすか。
 *
 * おおまかに「全角系の文字」を DBCS とする
 * （ひらがな・カタカナ・CJK・全角英数記号など）。
 */
export function isDbcsCodePoint(codePoint: number): boolean {
  if (
    (codePoint >= 0x3040 && codePoint <= 0x30ff) || // Hiragana/Katakana
    (codePoint >= 0x3400 && codePoint <= 0x9fff) || // CJK Unified Ideographs + Ext.A
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
    (codePoint >= 0xff01 && codePoint <= 0xff60) || // Fullwidth ASCII variants
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) // Fullwidth currency etc.
  ) {
    return true;
  }

  return false;
}

/**
 * 実機での印刷桁数を求める。
 *
 * **ローカルのソースに SO/SI は存在しない。** `.pf` を生バイトで見ると日本語は
 * UTF-8 のまま入っており（`346 274 242` = `漢`）、`0x0E`/`0x0F` は無い。
 * `dbcsShiftMarkers` が `{` `}` を見せているのは装飾で、文字としては無い。
 *
 * 一方、実機のメンバー上では DBCS の連なりの前後に SO と SI が 1 桁ずつ入り、
 * 全角 1 文字は 2 桁を占める。**ソースに無い分を計算で足す**のがこの関数の役目。
 *
 * ```
 *   'ABC'        → 3
 *   '顧客一覧表'  → SO(1) + 5*2 + SI(1) = 12
 *   'A顧客B'     → 1 + SO(1) + 2*2 + SI(1) + 1 = 8
 *   'あZい'      → SO(1)+2+SI(1) + 1 + SO(1)+2+SI(1) = 9
 * ```
 *
 * 最後の例のとおり、**DBCS が途切れるたびに SO/SI が要る**ので、
 * 全角の総数だけを数えても正しくならない。
 */
export function printWidth(text: string): number {
  let width = 0;
  let inDbcsRun = false;

  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;

    if (isDbcsCodePoint(codePoint)) {
      if (!inDbcsRun) {
        width += 1; // シフトアウト
        inDbcsRun = true;
      }
      width += 2;
      continue;
    }

    if (inDbcsRun) {
      width += 1; // シフトイン
      inDbcsRun = false;
    }
    width += 1;
  }

  if (inDbcsRun) {
    width += 1; // 行末までDBCSが続いた場合のシフトイン
  }

  return width;
}
