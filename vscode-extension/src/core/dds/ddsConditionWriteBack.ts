import { ddsReplaceField } from "../ddsLayout";
import { DDS_CONDITIONING } from "./ddsLogicalUnits";
import { isScreenSizeConditionName } from "./dspfScreenSize";
import type { IndicatorTerm } from "./ddsConditioning";

/**
 * 条件付け欄（7-16 桁）への**書き戻し**。読む側は `ddsConditioning`。
 *
 * ## 欄の並び（原典）
 *
 * > **7 桁目 (AND)** AND 条件をつくるために 4 つ以上の標識が必要な場合には、標識を次の行以降に
 * > 指定します。AND 条件の継続を示すためには、2 行目以降の 7 桁目に A を指定してもよいのですが、
 * > **この A はデフォルト**なので、7 桁目をブランクのままにしておいても差し支えありません。
 * > **7 桁目 (OR)** OR で結ばれる複数の条件を指定する場合には、各条件をそれぞれ新しい行から
 * > 書き始め、**最初の条件以外のすべての条件については、7 桁目に O を指定**しなければなりません。
 * > **8 桁目、11 桁目、14 桁目 (NOT)** …標識の直前の桁に N を指定します。
 *
 * つまり 7 = A/O、8-10 / 11-13 / 14-16 = `[N]nn` の 3 枠。
 *
 * ## 上限も原典が決めている
 *
 * > 1 つのフィールドまたはキーワードについて**最大 9 つの条件**を指定することができ、
 * > 1 つの条件について**最大 9 つの標識**を指定することができます。したがって、
 * > 1 つのフィールドまたはキーワードについて、**最大 81 個の標識**を指定することができます。
 *
 * ## 項目は最後の行に置く
 *
 * > フィールドについて条件を設定する際には、そのフィールド名 (または固定情報) と
 * > **最後の (または唯一の) 標識は同じ行に指定**しなければなりません。
 *
 * したがって書き出す行は「条件だけの行が n-1 本 → 代表行」の順になる。
 *
 * このモジュールは **vscode を import しない**。
 */

/** 1 行に書ける標識の数（8-10 / 11-13 / 14-16）。 */
export const TERMS_PER_LINE = 3;

/** 原典の上限。 */
export const CONDITION_LIMITS = {
  /** 1 つの条件（AND の組）に書ける標識の数。 */
  termsPerGroup: 9,
  /** OR で結べる条件の数。 */
  groups: 9
} as const;

/** OR で結ばれる AND の組。**空なら条件なし**。 */
export type ConditionGroups = readonly (readonly IndicatorTerm[])[];

/** 標識 1 つ分（3 桁）。`N` は直前の桁。 */
function formatTerm(term: IndicatorTerm | undefined): string {
  if (term === undefined) return "   ";
  return `${term.negated ? "N" : " "}${term.indicator.padStart(2, "0")}`;
}

/**
 * 条件付け欄（10 桁）を組み立てる。
 *
 * @param join    7 桁目。`" "`（最初の条件）/ `"O"`（新しい条件）/ `"A"`（AND の継続）
 * @param terms   その行に載せる標識（最大 3）
 */
export function formatConditioningArea(
  join: " " | "O" | "A",
  terms: readonly IndicatorTerm[]
): string {
  let area = join;
  for (let slot = 0; slot < TERMS_PER_LINE; slot += 1) {
    area += formatTerm(terms[slot]);
  }
  return area;
}

/**
 * **画面サイズ条件名**を書いた条件付け欄（10 桁）。
 *
 * 条件付け欄には標識のほかに画面サイズ条件名（`*DS3` 等）も入る。原典:
 * > DSPSIZ キーワードに指定した画面サイズ条件名によって、キーワードの使用や
 * > フィールドの位置を条件付けることができます。
 *
 * **7 桁目はブランクで、名前は 8 桁目から**（`readConditioning` が
 * 「8 桁目から `*` で始まる」で読んでいるのと対になる）。
 */
export function formatScreenSizeArea(name: string): string {
  return ` ${name.toUpperCase()}`.padEnd(10, " ").slice(0, 10);
}

/**
 * 画面サイズ条件名を書き戻した行。**1 本だけ**（名前は AND も OR もしない）。
 */
export function writeBackScreenSizeCondition(
  representativeLine: string,
  name: string
): string[] {
  return [
    ddsReplaceField(representativeLine, DDS_CONDITIONING, formatScreenSizeArea(name)).trimEnd()
  ];
}

/** 条件付け欄を消した行（7-16 桁をブランクに）。 */
export function clearConditioning(line: string): string {
  return ddsReplaceField(line, DDS_CONDITIONING, " ".repeat(10)).trimEnd();
}

/** 条件だけの行（6 桁目の `A` と条件付け欄だけ。17 桁目以降は空）。 */
function conditioningOnlyLine(area: string): string {
  return `     A${area}`.trimEnd();
}

/**
 * 条件を書くのに要る**行数**（代表行を含む）。
 *
 * `writeBackCondition` が返す本数と**必ず一致する**（テストで固定）。
 * UI が「編集で項目の行が何行ずれるか」を知るのに要る——ずれた分だけ選択が
 * 迷子になるため。数え方をあちらに書き写すと、片方だけ直したときに黙ってずれる。
 */
export function conditionLineCount(groups: ConditionGroups): number {
  const areas = groups.reduce(
    (total, terms) => total + Math.ceil(terms.length / TERMS_PER_LINE),
    0
  );
  // 条件が無くても代表行は要る。
  return Math.max(1, areas);
}

/**
 * 条件を書き戻した行群を返す。**最後の 1 本が代表行**（項目の桁を持つ行）。
 *
 * 条件が空なら代表行 1 本だけ（条件付け欄はブランク）。
 * 1 つの組が 3 を超えるときは行を足し、2 行目以降の 7 桁目に `A` を書く
 * （原典では省略できるが、**書いた方が「続き」だと目で分かる**）。
 */
export function writeBackCondition(
  representativeLine: string,
  groups: ConditionGroups
): string[] {
  const areas: string[] = [];

  groups.forEach((terms, groupIndex) => {
    for (let offset = 0; offset < terms.length; offset += TERMS_PER_LINE) {
      const chunk = terms.slice(offset, offset + TERMS_PER_LINE);
      const join: " " | "O" | "A" =
        offset > 0 ? "A" : groupIndex === 0 ? " " : "O";
      areas.push(formatConditioningArea(join, chunk));
    }
  });

  if (areas.length === 0) return [clearConditioning(representativeLine)];

  // **最後の欄を代表行に置く**（原典: 項目は最後の標識と同じ行）。
  const last = areas[areas.length - 1];
  return [
    ...areas.slice(0, -1).map(conditioningOnlyLine),
    ddsReplaceField(representativeLine, DDS_CONDITIONING, last).trimEnd()
  ];
}

/**
 * 人が打つための**短い形**。`N50 01, 60` ＝「(N50 かつ 01) または 60」。
 *
 * **これは DDS の書き方ではなく、このデザイナの入力欄の書き方**。
 * ソースの桁（`A`/`O`/`N`/3 桁枠）を打たせると必ずずれるので、
 * AND を空白・OR をカンマにした 1 行の形にして、書き戻しは `writeBackCondition` に任せる。
 *
 * 読む側（`formatConditionText`）と書く側（`parseConditionText`）で**同じ形**を使う
 * ——往復しない形にすると、開いて閉じただけで条件が変わる。
 */
export function formatConditionText(groups: ConditionGroups): string {
  return groups
    .map(terms =>
      terms.map(term => `${term.negated ? "N" : ""}${term.indicator}`).join(" ")
    )
    .join(", ");
}

export type ParsedCondition =
  | { readonly ok: true; readonly groups: ConditionGroups; readonly screenSize?: undefined }
  /** 画面サイズ条件名（`*DS3` 等）。標識とは**別の欄の使い方**なので混ぜない。 */
  | { readonly ok: true; readonly groups: readonly []; readonly screenSize: string }
  | { readonly ok: false; readonly message: string };

/**
 * 短い形を読む。**空文字は「条件なし」**（消す指定）。
 *
 * 標識は 01-99。`5` のように 1 桁で打たれたら `05` に揃える
 * （原典は 2 桁だが、打つ側に 0 詰めを強いる理由が無い）。
 */
export function parseConditionText(text: string): ParsedCondition {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: true, groups: [] };

  // **画面サイズ条件名**（`*DS3` / ユーザー定義名）。標識と混ぜられない
  // ——AND でも OR でもないので、書けるのは 1 つだけ。
  if (trimmed.startsWith("*")) {
    const name = trimmed.toUpperCase();
    if (!isScreenSizeConditionName(name)) {
      return {
        ok: false,
        message: `画面サイズ条件名 '${trimmed}' が無効です（原典: 2 - 8 文字で、最初の文字は *）`
      };
    }
    return { ok: true, groups: [], screenSize: name };
  }

  const groups: IndicatorTerm[][] = [];
  for (const part of trimmed.split(",")) {
    const words = part.trim().split(/\s+/u).filter(word => word.length > 0);
    if (words.length === 0) {
      return { ok: false, message: "カンマの間が空です（OR で結ぶ条件を書いてください）" };
    }
    const terms: IndicatorTerm[] = [];
    for (const word of words) {
      const match = /^(N?)(\d{1,2})$/iu.exec(word);
      if (!match) {
        return {
          ok: false,
          message: `'${word}' は標識として読めません（例: 50 / N50。AND は空白、OR はカンマ）`
        };
      }
      const indicator = match[2].padStart(2, "0");
      if (indicator === "00") {
        return { ok: false, message: "標識は 01-99 です（原典）" };
      }
      terms.push({ indicator, negated: match[1].toUpperCase() === "N" });
    }
    groups.push(terms);
  }
  return { ok: true, groups };
}
