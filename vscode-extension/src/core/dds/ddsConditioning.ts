import { conditioningAreaOf } from "./ddsLogicalUnits";
import { isScreenSizeConditionName } from "./dspfScreenSize";

/**
 * 条件付け欄（7 - 16 桁目）を読む。
 *
 * 原典（`表示装置ファイルの条件付け (7 - 16 桁目)`）:
 * > **7 桁目 (OR)** … OR で結ばれる複数の条件を指定する場合には、各条件をそれぞれ
 * > 新しい行から書き始め、最初の条件以外のすべての条件については、7 桁目に O を
 * > 指定しなければなりません。
 * > AND 条件の継続を示すためには、2 行目以降の 7 桁目に A を指定してもよいのですが、
 * > **この A はデフォルト**なので、7 桁目をブランクのままにしておいても差し支えありません。
 * > **8 桁目、11 桁目、14 桁目 (NOT)** … 標識がオンではなくオフであることが必要な場合には、
 * > その標識の直前の桁に N を指定します。
 *
 * ■ 標識だけではない
 *   原典（同上）:
 *   > **画面サイズ条件名** … DSPSIZ キーワードに指定した画面サイズ条件名によって、
 *   > キーワードの使用や**フィールドの位置を条件付ける**ことができます。
 *
 *   `*DS4` や `*NORMAL` がこの欄に入り、**2 次画面での位置**を指定する。
 *   標識（01-99）だけを読むと、この形の位置指定を黙って取りこぼす。
 *
 * ■ 欄の並び（10 桁）
 *   7 桁目 = A / O、8-10 = [N]標識、11-13 = [N]標識、14-16 = [N]標識。
 *   画面サイズ条件名のときは 8 桁目から名前が入る（7 桁目はブランク）。
 */

export interface IndicatorTerm {
  /** 01-99。 */
  readonly indicator: string;
  /** N が付いていれば true（オフのときに成立）。 */
  readonly negated: boolean;
}

export interface IndicatorClause {
  /** その行の 7 桁目。ブランクは "A"（原典: A が既定）。 */
  readonly join: "A" | "O";
  readonly terms: readonly IndicatorTerm[];
}

export type Conditioning =
  | { readonly kind: "none" }
  | { readonly kind: "indicators"; readonly clauses: readonly IndicatorClause[] }
  | { readonly kind: "screen-size"; readonly name: string };

/** 標識 1 つ分の桁（8-10 / 11-13 / 14-16）。 */
const INDICATOR_SLOTS: readonly number[] = [0, 3, 6];

/**
 * 論理単位の行群から条件付けを読む。
 *
 * 行は「先行する条件行 → 代表行」の順に渡す（`LogicalUnit.conditioningLines`）。
 * 原典より、項目は**最後の標識と同じ行**にあるため、代表行も条件を持ちうる。
 */
export function readConditioning(lines: readonly string[]): Conditioning {
  const clauses: IndicatorClause[] = [];
  let screenSizeName: string | undefined;

  for (const line of lines) {
    const area = conditioningAreaOf(line);
    if (area.trim().length === 0) continue;

    const join = area.charAt(0).toUpperCase() === "O" ? "O" : "A";
    // 8-16 桁（標識 3 つ分、または画面サイズ条件名）。
    const body = area.slice(1);

    // 画面サイズ条件名（8 桁目から `*` で始まる）。
    const trimmedBody = body.trim();
    if (trimmedBody.startsWith("*")) {
      if (isScreenSizeConditionName(trimmedBody)) {
        screenSizeName = trimmedBody.toUpperCase();
      }
      continue;
    }

    const terms: IndicatorTerm[] = [];
    for (const offset of INDICATOR_SLOTS) {
      const slot = body.slice(offset, offset + 3);
      if (slot.trim().length === 0) continue;
      const negated = slot.charAt(0).toUpperCase() === "N";
      const indicator = slot.slice(1).trim();
      if (!/^\d{1,2}$/u.test(indicator)) continue;
      terms.push({ indicator: indicator.padStart(2, "0"), negated });
    }

    if (terms.length > 0) clauses.push({ join, terms });
  }

  // 画面サイズ条件名と標識が同じ項目に付くことは原典上ありうるが、
  // 位置の条件付けとしては画面サイズが効くので、そちらを優先して返す。
  if (screenSizeName !== undefined) {
    return { kind: "screen-size", name: screenSizeName };
  }
  if (clauses.length === 0) return { kind: "none" };
  return { kind: "indicators", clauses };
}

/**
 * 2 つの条件付けが「同時に成立しえない」と**静的に言い切れる**か。
 *
 * 重なりの検出を抑えるために使う。原典より、条件が違うフィールドどうしの
 * 重なりは**正当**（一時点で表示されるのは 1 つだけ）なので、
 * 条件を読まずに重なりを報告すると実務の DSPF で誤検出が大量に出る。
 *
 * ■ 保守的に倒す（初版）
 *   「排他である」と言えるときだけ true を返す。標識の同値判定
 *   （`01` と `N01` が背反、`01` と `01` が同時成立、など）まで踏み込むと
 *   偽陽性・偽陰性の両方を生むため、**片方でも条件が付いていれば排他とみなす**。
 *   結果として重なりを報告するのは「両方とも無条件」のときだけになる。
 */
export function isMutuallyExclusive(a: Conditioning, b: Conditioning): boolean {
  if (a.kind === "none" && b.kind === "none") return false;
  return true;
}
