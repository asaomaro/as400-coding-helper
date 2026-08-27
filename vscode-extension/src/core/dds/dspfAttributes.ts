import attributeData from "../../../resources/completion/dds-attributes.json";
import {
  activeKeywordGroups,
  type IndicatorStates,
  type KeywordGroup
} from "./ddsConditioning";
import { parseKeywordEntries } from "./ddsKeywords";

/**
 * `COLOR` / `DSPATR` から**実機の表示属性**を求める。
 *
 * ## 表は原典から生成したもの
 *
 * 対応表は `docs/origin/generate-dds-attributes.mjs` が原典の 16 進表
 * （DSPATR の「有効な P フィールド値」）から作る。**ここが持つのは表の引き方だけ**で、
 * 色や属性の組み合わせを手で書かない（AGENTS.md）。
 * `verify-dds-attributes.mjs` が、原典の**2 つの表**（16 進表と COLOR ページの
 * `CS`/`HI`/`BL` の表）が食い違っていないことも見ている。
 *
 * ## 書いたのに出ない組み合わせがある
 *
 * 原典（`DSPATR`）:
 * > 5250 表示装置を使用する場合に、同一フィールドについて **UL、HI、および RI の 3 つの属性を
 * > 同時に指定した場合には、ND を指定した場合と同じ結果**になります。
 *
 * コンパイルは通り、警告も出ない。**実機に出して初めて「消えている」と分かる**類なので、
 * デザイナが先に見せる。
 *
 * ## このモジュールは `vscode` を import しない。
 */

export type ScreenColor =
  | "green" | "white" | "red" | "turquoise" | "yellow" | "pink" | "blue";

export interface ScreenAppearance {
  /** 実機の表示属性バイト（`0x20`-`0x3F`）。実機と突き合わせるために持つ。 */
  readonly byte: number;
  readonly color: ScreenColor;
  readonly reverse: boolean;
  readonly underline: boolean;
  /** 明滅する色は**赤だけ**（原典）。点滅させずに印で示す。 */
  readonly blink: boolean;
  /**
   * 非表示。**桁は占有するが文字が出ない。**
   *
   * `DSPATR(ND)` のほか、原典より **`UL` ＋ `HI` ＋ `RI` の 3 つ**でも同じ結果になる。
   * コンパイルは通り、警告も出ない。
   */
  readonly nonDisplay: boolean;
}

interface ColorRow {
  readonly cs: boolean;
  readonly hi: boolean;
  readonly bl: boolean;
  readonly color: string;
  readonly blink: boolean;
}

const BITS = attributeData.bits as Record<string, number>;
const COLOR_BITS = attributeData.colorBits as Record<string, number>;
const COLOR_ROWS = attributeData.colors as readonly ColorRow[];

/** 見え方に効く `DSPATR` の値。`PC` / `MDT` / `OID` / `SP` / `PR` は色にも属性にも効かない。 */
const VISUAL_DSPATR = new Set(["RI", "HI", "UL", "BL", "CS", "ND"]);

/** `COLOR` に書ける値（原典）。 */
const COLOR_NAMES: Readonly<Record<string, ScreenColor>> = {
  GRN: "green",
  WHT: "white",
  RED: "red",
  TRQ: "turquoise",
  YLW: "yellow",
  PNK: "pink",
  BLU: "blue"
};

/** 非表示になるビットの組（原典: UL・HI・RI の 3 つを同時に指定すると ND と同じ結果）。 */
const NON_DISPLAY_BITS = BITS.RI | BITS.HI | BITS.UL;

export const DEFAULT_APPEARANCE: ScreenAppearance = appearanceOf(BITS.base);

/**
 * キーワード欄から表示属性を求める。
 *
 * ■ `COLOR` は最初のものが効く
 *   原典（`COLOR`）:
 *   > 1 つの出力命令について 2 つ以上の COLOR キーワードが有効になっている場合には、
 *   > IBM i オペレーティング・システムは、**DDS で最初に指定されている COLOR キーワード**を
 *   > 使用します
 *
 * ■ `COLOR` を書くと `CS` / `HI` / `BL` は色に吸収される
 *   色は `CS`/`HI`/`BL` の 3 ビットそのものなので、色を書けばその 3 ビットは色が決める。
 *   原典が「HI は無視されます」等と散文で並べているのはこのこと。
 *
 * ■ **`COLOR` ＋ `RI` ＋ `UL` は `UL` が落ちる**（実機で確認）
 *   色が `HI` を含む（白・黄・青）と、`RI` と `UL` を足したビットは `0x_7` ＝ 非表示になる。
 *   原典は「**RI は無視されます**」と書いているが、**実機は `UL` を落とす**
 *   （2026-08-27 / IBM i 7.3 で全 61 通りを画面と突き合わせて確認。
 *   `COLOR(WHT) DSPATR(RI UL)` は白の反転表示になり、下線は付かない）。
 *   AGENTS.md「原典と実機が食い違ったら、実機のパーサーに判定させる」に従い**実機を採る**。
 *
 *   なお `COLOR` を書かずに `DSPATR(HI RI UL)` と**明示した**場合は原典どおり非表示になる
 *   （こちらも実機で確認済み）。落とすのは色から来た `HI` のときだけ。
 *
 * ■ 条件つきの `COLOR` / `DSPATR` は `resolveAppearanceUnder` が扱う
 *   `50 COLOR(RED)` のような形は、その項目の条件とは**別の条件**で効いたり効かなかったりする。
 *   この関数は渡された欄をそのまま解くので、**条件で絞ってから**呼ぶこと。
 */
export function resolveAppearance(keywords: string): ScreenAppearance {
  let color: ScreenColor | undefined;
  const dspatr = new Set<string>();

  for (const entry of parseKeywordEntries(keywords)) {
    if (entry.kind !== "keyword" || entry.parameters === undefined) continue;
    const values = entry.parameters
      .split(/[\s,]+/u)
      .map(value => value.trim().toUpperCase())
      .filter(value => value.length > 0);

    if (entry.name === "COLOR") {
      if (color === undefined) color = COLOR_NAMES[values[0]];
      continue;
    }
    if (entry.name === "DSPATR") {
      for (const value of values) {
        if (VISUAL_DSPATR.has(value)) dspatr.add(value);
      }
    }
  }

  let byte = BITS.base;
  if (color !== undefined) {
    byte |= COLOR_BITS[color];
  } else {
    if (dspatr.has("CS")) byte |= BITS.CS;
    if (dspatr.has("HI")) byte |= BITS.HI;
    if (dspatr.has("BL")) byte |= BITS.BL;
  }
  if (dspatr.has("RI")) byte |= BITS.RI;
  if (dspatr.has("UL")) byte |= BITS.UL;
  if (dspatr.has("ND")) byte |= NON_DISPLAY_BITS;

  // 色から来た HI で非表示になってしまう組は、実機が UL を落とす。
  const explicitNonDisplay = dspatr.has("ND") || (dspatr.has("HI") && dspatr.has("RI") && dspatr.has("UL"));
  if (color !== undefined && !explicitNonDisplay && (byte & NON_DISPLAY_BITS) === NON_DISPLAY_BITS) {
    byte &= ~BITS.UL;
  }

  return appearanceOf(byte);
}

/**
 * **成立している条件のキーワードだけ**で見え方を求める。
 *
 * 原典（`COLOR`）:
 * > 1 つの出力命令について 2 つ以上の COLOR キーワードが**有効になっている**場合には、
 * > …**DDS で最初に指定されている COLOR キーワード**を使用します
 *
 * 「有効になっている」ものの最初なので、**先に条件で絞り、そのあと最初のものを採る**。
 * 群はソースの順に並んでいるので、連結した順がそのまま指定の順になる。
 */
export function resolveAppearanceUnder(
  groups: readonly KeywordGroup[],
  states: IndicatorStates
): ScreenAppearance {
  return resolveAppearance(
    activeKeywordGroups(groups, states)
      .map(group => group.keywords)
      .join(" ")
      .trim()
  );
}

/**
 * 属性バイトから見え方を組み立てる。
 *
 * ■ 色と明滅は `CS`/`HI`/`BL` から（原典の色の表）
 * ■ 反転表示・下線・非表示はビットから
 *   非表示は低位 3 ビットが揃ったとき（原典: UL・HI・RI ＝ ND）。
 *
 * ■ 桁区切り線は**持たない**
 *   原典の 2 つの表で扱いが食い違う（16 進表は `0x34` に「桁区切り線」を含めるが、
 *   実機の画面では付かない）。見た目は文字間の細い点で、原典自身が
 *   「空色および黄色の各フィールドには、DSPATR(CS) の指定がない場合でも、桁区切り線が入ります」
 *   「行間隔縮小モードにすると、このドットは消えます」と書いている。
 *   **描いても意味を持たないので、モデルに入れない。**
 */
function appearanceOf(byte: number): ScreenAppearance {
  const cs = (byte & BITS.CS) !== 0;
  const hi = (byte & BITS.HI) !== 0;
  const bl = (byte & BITS.BL) !== 0;
  const row = COLOR_ROWS.find(candidate => candidate.cs === cs && candidate.hi === hi && candidate.bl === bl);

  const nonDisplay = (byte & NON_DISPLAY_BITS) === NON_DISPLAY_BITS;

  // **非表示なら他の属性は意味を持たない。** 何も出ないので反転も下線も明滅も無い
  // （実機の画面もそう報告する。2026-08-27 に全 61 通りで確認）。
  return {
    byte,
    color: (row?.color ?? "green") as ScreenColor,
    reverse: !nonDisplay && (byte & BITS.RI) !== 0,
    underline: !nonDisplay && (byte & BITS.UL) !== 0,
    blink: !nonDisplay && (row?.blink ?? false),
    nonDisplay
  };
}
