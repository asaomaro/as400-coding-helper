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

/**
 * 実機の桁数が `max` を超え始める位置（**JS の添字**）。超えなければ undefined。
 *
 * `printWidth` は「全体で何桁か」しか答えないが、指摘の下線を引くには
 * **どこから溢れたか**が要る。エディタの列は JS の添字なので、桁とは別物。
 *
 * SO/SI の分は `printWidth` と同じ数え方（DBCS の連なりの前後に 1 桁ずつ）。
 */
export function indexExceedingWidth(text: string, max: number): number | undefined {
  let width = 0;
  let inDbcsRun = false;
  let index = 0;

  for (const character of text) {
    const codePoint = character.codePointAt(0);
    const dbcs = codePoint !== undefined && isDbcsCodePoint(codePoint);

    // この 1 文字を置いたら何桁になるか。DBCS の切れ目では SO / SI が入る。
    let next = width;
    if (dbcs) {
      if (!inDbcsRun) next += 1; // シフトアウト
      next += 2;
    } else {
      if (inDbcsRun) next += 1; // シフトイン
      next += 1;
    }
    // 行末の DBCS には必ずシフトインが要る。
    const closed = dbcs ? next + 1 : next;
    if (closed > max) return index;

    width = next;
    inDbcsRun = dbcs;
    index += character.length;
  }
  return undefined;
}
