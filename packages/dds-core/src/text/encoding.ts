/**
 * 表示桁の換算。**この機能の正しさの中核**であり、DDS を扱う全経路がここを通る。
 *
 * ## なぜ換算が要るか（実測に基づく）
 *
 * IBM i のソースメンバは EBCDIC で、DBCS の前後に SO(0x0E) / SI(0x0F) が実バイトとして入る。
 * 5250 画面では DBCS が 2 桁、SO / SI が各 1 桁を占めるため、**EBCDIC のバイト数と表示桁数が一致する**。
 *
 * ところが UTF-8 へ変換して PC へ落とすと **SO / SI は消える**。実測（`ASAOLIB/QJPNTEST(JPNATTR)`）:
 *
 * ```
 * 実機(EBCDIC):  c1 e7 28 0e 45e2 45c9 0f c3 c4   = 11 バイト = 11 表示桁
 *                 A  X  -- SO  設    計   SI  C  D
 * UTF-8 変換後:  41 58 c288 e8a8ad e8a888 43 44   = 7 文字（SO/SI 消滅）
 * ```
 *
 * つまり編集対象のファイル（UTF-8）には SO / SI が存在せず、**表示桁は文字列から再構成するしかない**。
 * その再構成がこのモジュールの仕事。
 *
 * ## 書き戻しについて
 *
 * **SO / SI をファイルへ書き込んではならない。** UTF-8 から EBCDIC へ戻す変換が自動で再挿入し、
 * 元メンバとバイト単位で一致することを実測で確認済み。書くと二重挿入になる。
 * ここで行うのは「どこに入るか」の計算だけ。
 *
 * ## 索引と桁の基点（混同が最大の事故源）
 *
 * - **索引は 0 始まりの UTF-16 コード単位**（JS の文字列添字。VSCode の Position も同じ基準）。
 * - **桁は 1 始まり**（DDS の桁表記に合わせる）。
 *
 * ## 依存について
 *
 * **このモジュールは何にも依存しない（依存グラフの葉）。** 「換算は 1 か所」という設計上の保証は、
 * この位置づけで担保している。ここに import を足すとその保証が崩れる。
 */

/** SO(shift out) が占める表示桁数。 */
const SO_COLUMNS = 1;
/** SI(shift in) が占める表示桁数。 */
const SI_COLUMNS = 1;
/** DBCS 文字が占める表示桁数。 */
const DBCS_COLUMNS = 2;
/** SBCS 文字が占める表示桁数。 */
const SBCS_COLUMNS = 1;

/**
 * コードポイントが DBCS（全角）かを判定する。
 *
 * **判定範囲は `vscode-extension/src/language/dbcsShiftMarkers.ts` から一字一句そのまま移送している。**
 * 既存の SOSI 表示と判定が食い違うと、同じファイルをルーラー / SOSI とビジュアルエディタが
 * 別の桁で語ることになるため、ここを勝手に広げてはならない（変更するなら要件から起こす）。
 *
 * 範囲がすべて BMP であることの帰結として、**サロゲートペア（0xFFFF 超）は「DBCS ではないが
 * 2 コード単位を消費する」**扱いになる。これは現行実装の忠実な再現。
 * EBCDIC に対応する文字が無いため実務上は現れない。
 */
export function isDbcsCodePoint(codePoint: number): boolean {
  // おおまかに「全角系の文字」を DBCS とみなす
  // - Hiragana, Katakana, CJK, 全角英数・記号など
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

/** 走査結果。公開 API はすべてこれを土台にする（走査を 1 か所に閉じるため）。 */
interface Layout {
  /** 各コード単位索引に対する開始表示桁（1 始まり）。DBCS の後続コード単位は -1。 */
  readonly startColumn: readonly number[];
  /** 各表示桁（1 始まり）を占めるものの種別。索引 0 は未使用。 */
  readonly occupant: readonly Occupant[];
  /** 文字列全体の表示桁数。 */
  readonly width: number;
  /** SO が入る表示桁位置。 */
  readonly so: readonly number[];
  /** SI が入る表示桁位置。 */
  readonly si: readonly number[];
  /** 末尾（`text.length`）に対応する表示桁。末尾 SI があればその次を指す。 */
  readonly endColumn: number;
}

interface Occupant {
  /** 何がこの桁を占めているか。 */
  readonly kind: "so" | "si" | "char" | "char-tail";
  /** 対応するコード単位索引。`si` は run 直後の索引（末尾なら `text.length`）。 */
  readonly index: number;
}

function scan(text: string): Layout {
  const startColumn: number[] = new Array<number>(text.length).fill(-1);
  const occupant: Occupant[] = [];
  const so: number[] = [];
  const si: number[] = [];

  // occupant は 1 始まりの桁で引くので、索引 0 を埋めておく。
  occupant.push({ kind: "char", index: -1 });

  let column = 1;
  let inDbcs = false;
  let index = 0;

  while (index < text.length) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }

    const dbcs = isDbcsCodePoint(codePoint);
    const codeUnitLength = codePoint > 0xffff ? 2 : 1;

    if (dbcs && !inDbcs) {
      so.push(column);
      occupant.push({ kind: "so", index });
      column += SO_COLUMNS;
      inDbcs = true;
    } else if (!dbcs && inDbcs) {
      // run が終わった直後の索引で SI を数え込む。ここを落とすと 1 桁ずれる。
      si.push(column);
      occupant.push({ kind: "si", index });
      column += SI_COLUMNS;
      inDbcs = false;
    }

    startColumn[index] = column;

    const width = dbcs ? DBCS_COLUMNS : SBCS_COLUMNS;
    occupant.push({ kind: "char", index });
    for (let extra = 1; extra < width; extra += 1) {
      occupant.push({ kind: "char-tail", index });
    }
    column += width;

    index += codeUnitLength;
  }

  if (inDbcs) {
    // 文字列が DBCS run の途中で終わる場合、末尾に SI が入る。
    si.push(column);
    occupant.push({ kind: "si", index: text.length });
    column += SI_COLUMNS;
  }

  return {
    startColumn,
    occupant,
    width: column - 1,
    so,
    si,
    endColumn: column
  };
}

/**
 * 文字列が 5250 画面で占める表示桁数を返す。
 *
 * SBCS = 1 桁 / DBCS = 2 桁 に加え、**DBCS の連続範囲ごとに SO 1 桁と SI 1 桁**を足す。
 */
export function displayWidth(text: string): number {
  return scan(text).width;
}

/**
 * 0 始まりのコード単位索引を、1 始まりの表示桁へ変換する。
 *
 * `index === text.length` を渡すと「末尾の次の桁」を返す（末尾 SI があればそれを数え込んだ位置）。
 *
 * @throws RangeError 索引が範囲外の場合
 */
export function charIndexToColumn(text: string, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index > text.length) {
    throw new RangeError(
      `索引が範囲外です: ${index}（許容 0..${text.length}）`
    );
  }

  const layout = scan(text);

  if (index === text.length) {
    return layout.endColumn;
  }

  const column = layout.startColumn[index];
  if (column === -1) {
    // サロゲートペアの後続コード単位を指した場合。先頭側に丸めず、跨ぎとして扱えるよう
    // 直前の開始桁を返す（呼び出し側は columnToCharIndex で straddles を確認できる）。
    for (let back = index - 1; back >= 0; back -= 1) {
      if (layout.startColumn[back] !== -1) {
        return layout.startColumn[back];
      }
    }
    return 1;
  }

  return column;
}

/** `columnToCharIndex` の結果。 */
export interface ColumnLookup {
  /** 対応する 0 始まりコード単位索引。 */
  readonly index: number;
  /**
   * 指定桁が文字の開始位置ではなかった場合に `true`。
   *
   * DBCS の 2 桁目 / SO の桁 / SI の桁がこれに当たる。
   * **`true` のときに黙って丸めてはならない。** 丸めると 1 桁ずれが静かに混入する。
   */
  readonly straddles: boolean;
}

/**
 * 1 始まりの表示桁を、0 始まりのコード単位索引へ変換する。
 *
 * 文字列の表示幅を超える桁を指した場合は `{ index: text.length, straddles: false }` を返す。
 * DDS のソース行は空白で右詰めされるため、内容より右の桁を指すのは正当な操作。
 *
 * @throws RangeError 桁が 1 未満の場合（桁は 1 始まり）
 */
export function columnToCharIndex(text: string, column: number): ColumnLookup {
  if (!Number.isInteger(column) || column < 1) {
    throw new RangeError(`桁は 1 始まりの整数です: ${column}`);
  }

  const layout = scan(text);

  if (column > layout.width) {
    return { index: text.length, straddles: false };
  }

  const occupant = layout.occupant[column];
  return {
    index: occupant.index,
    straddles: occupant.kind !== "char"
  };
}

/** SO / SI が入る表示桁位置。 */
export interface SosiPositions {
  /** SO が占める表示桁（1 始まり）。 */
  readonly so: readonly number[];
  /** SI が占める表示桁（1 始まり）。 */
  readonly si: readonly number[];
}

/**
 * DBCS の連続範囲から、SO / SI が入る表示桁位置を算出する。
 *
 * ファイルには存在しない（UTF-8 変換で消えている）ものを、描画のために再構成する用途。
 * **算出結果をファイルへ書き戻してはならない。**
 */
export function sosiPositions(text: string): SosiPositions {
  const layout = scan(text);
  return { so: layout.so, si: layout.si };
}

/* -------------------------------------------------------------------------
 * 座標系を語彙で分ける
 *
 * 同じ換算を使うが、**適用対象が違う 2 つの座標系**がある。取り違えると桁が壊れるので、
 * 呼び出し側が「今どちらを扱っているか」を名前で意識できるようにしておく。
 *
 *   1. ソース行内の桁 — DDS の各欄（名前 19-28 桁など）がソース行のどこにあるか。
 *      機能欄に DBCS リテラルがあると、それ以降の桁がずれる。
 *   2. 画面上の表示桁 — フィールドが 5250 画面のどこに出るか（39-41 桁 / 42-44 桁の値）。
 *
 * 分けているのは語彙であって、計算ではない。
 *
 * **非対称にしてある**: 座標系 1 には専用ラッパを置き、座標系 2 は素の関数（`displayWidth` 等）を
 * そのまま使う。両方に別名を用意すると「同じことをする 2 つの名前」ができ、
 * 語彙で取り違えを防ぐという狙いと逆に働く。
 * ----------------------------------------------------------------------- */

/**
 * 【座標系 1: ソース行内】ソース行の索引を、その行の中での桁へ変換する。
 *
 * @param rawLine DDS ソースの 1 行（生のまま）
 */
export function charIndexToSourceColumn(rawLine: string, index: number): number {
  return charIndexToColumn(rawLine, index);
}

/**
 * 【座標系 1: ソース行内】ソース行の桁を、その行の索引へ変換する。
 *
 * @param rawLine DDS ソースの 1 行（生のまま）
 */
export function sourceColumnToCharIndex(
  rawLine: string,
  column: number
): ColumnLookup {
  return columnToCharIndex(rawLine, column);
}
