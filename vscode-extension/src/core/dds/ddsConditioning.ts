import { isDdsBlankLine, isDdsCommentLine } from "../ddsLayout";
import { conditioningAreaOf, type LogicalUnit } from "./ddsLogicalUnits";
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

    // **画面サイズ条件名は 7 桁目からも書ける。** 実機で確かめた
    // （2026-08-28 / IBM i 7.3）: 7 桁目 = 通る / 8 桁目 = 通らない / 9 桁目 = 通る。
    // 欄全体を見て `*` で始まるなら名前として読む——7 桁目を AND/OR として
    // 切り落とすと、その形の条件が**黙って消える**。
    const trimmedArea = area.trim();
    if (trimmedArea.startsWith("*")) {
      if (isScreenSizeConditionName(trimmedArea)) {
        screenSizeName = trimmedArea.toUpperCase();
      }
      continue;
    }

    const join = area.charAt(0).toUpperCase() === "O" ? "O" : "A";
    // 8-16 桁（標識 3 つ分）。
    const body = area.slice(1);

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
 * 標識の状態。鍵は **2 桁**（`"01"`..`"99"`）。
 *
 * **未設定の標識は鍵ごと持たない。** `"unset"` のような値を作ると
 * 「未設定」を表す形が 2 つ（鍵が無い／値が unset）になり、
 * 空判定（`Object.keys(...).length === 0`）が壊れる。
 */
export type IndicatorStates = Readonly<Record<string, "on" | "off">>;

/**
 * 条件の解決結果。**3 値**。
 *
 * 未設定の標識を含む条件は `unknown`——「不成立」に倒すと、標識を 1 つ設定しただけで
 * 無関係な項目が消える。**消すのは不成立と決まったものだけ**。
 */
export type ConditionResult = "shown" | "hidden" | "unknown";

/**
 * 行単位の `clauses` を、原典の言う「条件」（OR で結ばれる AND の組）へ畳む。
 *
 * 原典（`表示装置ファイルの条件付け (7 - 16 桁目)`）:
 * > 2 - 9 個の標識を AND により結び付けて 1 つの条件にすることができます。
 * > OR で結ばれる複数の条件を指定する場合には、各条件をそれぞれ新しい行から書き始め、
 * > **最初の条件以外のすべての条件については、7 桁目に O を指定**しなければなりません。
 * > **最初の条件に O を指定した場合には、警告メッセージが出て、この桁はブランクとして処理されます。**
 *
 * したがって **1 行目は必ず新しい条件を開始する**（`O` が書かれていてもブランク扱い）。
 * 2 行目以降は `O` なら新しい条件、`A`・ブランクなら直前の条件に AND で足す。
 */
export function conditionGroups(
  conditioning: Conditioning
): readonly (readonly IndicatorTerm[])[] {
  if (conditioning.kind !== "indicators") return [];

  const groups: IndicatorTerm[][] = [];
  conditioning.clauses.forEach((clause, index) => {
    // 1 行目の O はブランク扱い（原典）。
    if (index === 0 || clause.join === "O") {
      groups.push([...clause.terms]);
      return;
    }
    groups[groups.length - 1].push(...clause.terms);
  });

  return groups;
}

/**
 * 標識の状態から、その項目（またはキーワード）が選択されるかを解決する。
 *
 * ■ 3 値の畳み方（Kleene）
 *   条件（AND）: 1 つでも偽 → 偽。偽が無く未知があれば → 未知。全部真 → 真。
 *   全体（OR）: 1 つでも真 → 真。真が無く未知があれば → 未知。全部偽 → 偽。
 *
 * ■ 画面サイズ条件名は常に成立として扱う
 *   1 次画面サイズに一致しないものは `resolveDspfLayout` が既に落としている
 *   （`dspfLayout.ts` の `matchesScreenSize`）。ここまで来たものは表示される。
 */
export function evaluateConditioning(
  conditioning: Conditioning,
  states: IndicatorStates
): ConditionResult {
  const groups = conditionGroups(conditioning);
  if (groups.length === 0) return "shown";

  let sawUnknown = false;
  for (const group of groups) {
    const value = evaluateGroup(group, states);
    if (value === true) return "shown";
    if (value === undefined) sawUnknown = true;
  }
  return sawUnknown ? "unknown" : "hidden";
}

/** AND の組を畳む。`undefined` は未知。 */
function evaluateGroup(
  terms: readonly IndicatorTerm[],
  states: IndicatorStates
): boolean | undefined {
  let sawUnknown = false;
  for (const term of terms) {
    const state = states[term.indicator];
    if (state === undefined) {
      sawUnknown = true;
      continue;
    }
    // N が付いていればオフのときに成立（原典: 8/11/14 桁目 (NOT)）。
    const satisfied = term.negated ? state === "off" : state === "on";
    if (!satisfied) return false;
  }
  return sawUnknown ? undefined : true;
}

/**
 * 人が読む形。例: `01 かつ N02、または 03`。条件が無ければ空文字。
 *
 * `N` を落として「オフ」と書き下さないのは、**ソースに書いてある形と対応させる**ため
 * （プロパティから該当行を探すときに、目で突き合わせられる）。
 */
export function describeConditioning(conditioning: Conditioning): string {
  if (conditioning.kind === "screen-size") return conditioning.name;

  const groups = conditionGroups(conditioning);
  if (groups.length === 0) return "";

  return groups
    .map((terms) =>
      terms
        .map((term) => `${term.negated ? "N" : ""}${term.indicator}`)
        .join(" かつ ")
    )
    .join("、または ");
}

/**
 * 条件つきのキーワード欄（条件を解いたもの）。
 *
 * `RawKeywordGroup`（桁を切っただけ）を配置解決が解いてこの形にする。
 * **見え方の解決だけがこれを見る**——`keywords`（全部の連結）の意味は変えていない。
 */
export interface KeywordGroup {
  readonly conditioning: Conditioning;
  readonly keywords: string;
  /** 1 始まり。キーワードが書かれている行。 */
  readonly sourceLine: number;
  /** 条件を書き換えるときに置き換える範囲（先行する条件行 → キーワードの行）。 */
  readonly sourceLines: readonly number[];
}

/**
 * 論理単位のキーワード群の条件を解く。**画面と帳票で同じものを使う。**
 *
 * 桁の切り出しは `toLogicalUnits`（条件の解釈をしない。環状 import になるため）、
 * 解釈はここ、という分担にしてある。
 */
export function resolveKeywordGroups(unit: LogicalUnit): KeywordGroup[] {
  return unit.keywordGroups.map(group => ({
    conditioning: readConditioning(group.conditioningLines),
    keywords: group.keywords,
    sourceLine: group.sourceLine,
    sourceLines: group.sourceLines
  }));
}

/**
 * その標識の状態で**効いているキーワード群**だけを残す。
 *
 * 倒し方は項目の表示と**同じ**（`applyIndicators` の「消すのは不成立と決まったものだけ」）:
 *
 * | 解決 | 効かせるか | 理由 |
 * |---|---|---|
 * | `shown` | ○ | 成立している |
 * | `unknown` | **○** | 未設定は「決まらない」。既定の見え方を変えないため |
 * | `hidden` | ✕ | 不成立と決まった |
 *
 * 片方だけ別の倒し方にすると、同じ標識で**項目は残るのに色だけ消える**が起きる。
 */
export function activeKeywordGroups(
  groups: readonly KeywordGroup[],
  states: IndicatorStates
): readonly KeywordGroup[] {
  return groups.filter(
    group => evaluateConditioning(group.conditioning, states) !== "hidden"
  );
}

/** ソース中に現れる標識。 */
export interface IndicatorUsage {
  /** `"01"`..`"99"`。 */
  readonly indicator: string;
  /** その標識が**書かれた桁の数**（行数ではない）。 */
  readonly uses: number;
}

/**
 * ソース中で使われている標識を、番号順に列挙する。
 *
 * ■ 論理単位を通さない
 *   原典は条件が付く対象を「フィールド**または**キーワード」としている:
 *   > ユーザー・プログラムでは、オプション標識をオン (16 進数 F1) またはオフ (16 進数 F0) に
 *   > セットすることにより、**フィールドまたはキーワード**を選択することができます。
 *
 *   `toLogicalUnits` は**キーワードだけの行**を直前の項目へ連結する際に、その行の条件付け欄を
 *   捨てる（項目の表示を決めるのは項目自身の条件だけなので、それ自体は正しい）。
 *   そのため `30 DSPATR(RI)` のような**キーワードを条件付ける標識は単位から拾えない**。
 *   一覧は「このファイルで意味を持つ標識」を出すものなので、**生の行**から集める。
 *
 * ■ 判定は `readConditioning` に委ねる
 *   注記行・空行を除いたうえで 1 行ずつ通す。桁の切り出しと妥当性の規則を 2 か所に書かない。
 *   `N` は状態の指定であって別の標識ではないので、`N01` も `01` として数える。
 */
export function collectIndicators(lines: readonly string[]): readonly IndicatorUsage[] {
  const counts = new Map<string, number>();

  for (const line of lines) {
    if (isDdsCommentLine(line) || isDdsBlankLine(line)) continue;
    const conditioning = readConditioning([line]);
    if (conditioning.kind !== "indicators") continue;
    for (const clause of conditioning.clauses) {
      for (const term of clause.terms) {
        counts.set(term.indicator, (counts.get(term.indicator) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([indicator, uses]) => ({ indicator, uses }));
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
