import levelData from "../../../resources/completion/dds-keyword-levels.json";
import { parseKeywordEntries } from "./ddsKeywords";
import { fileLevelKeywordLines, type LogicalUnit } from "./ddsLogicalUnits";

/**
 * キーワードを**どのレベルに書けるか**。
 *
 * 表は原典から生成する（`docs/origin/generate-dds-keyword-levels.mjs`）。
 * 名前とレベルだけの軽い資源にしてあるのは、`resolveDspfLayout` が
 * **WebView にも束ねられる**ため——解説つきの `dds-keywords.json` を
 * 取り込むと束が重くなる。
 *
 * ## 一覧に無いものは咎めない
 *
 * 原典がレベルを書いていないキーワードは表に入れていない。
 * **出すべきものを隠すより余分に出す方が害が少ない**（AGENTS.md）——
 * 咎める側では逆で、**判断できないものを咎めない**。
 */
export type KeywordLevelType = "PF" | "DSPF" | "PRTF";

export type PlacementLevel = "file" | "record" | "field";

const TABLES = levelData.keywords as Record<string, Record<string, string[]>>;

/** そのキーワードを書けるレベル。表に無ければ undefined（＝判断しない）。 */
export function levelsOf(
  ddsType: KeywordLevelType,
  keyword: string
): readonly PlacementLevel[] | undefined {
  const table = TABLES[ddsType];
  if (!table) return undefined;
  // 原典の総称（`CFnn`）は番号を付けて書かれる。`CF03` を `CFnn` に寄せて引く。
  const upper = keyword.toUpperCase();
  const direct = table[upper] ?? table[keyword];
  if (direct) return direct as PlacementLevel[];

  const numbered = /^([A-Z]+)(\d{2})$/u.exec(upper);
  if (!numbered) return undefined;
  const generic = table[`${numbered[1]}nn`];
  return generic ? (generic as PlacementLevel[]) : undefined;
}

/** キーワード欄に書かれたキーワードのうち、そのレベルに書けないもの。 */
export function keywordsNotAllowedAt(
  ddsType: KeywordLevelType,
  keywords: string,
  level: PlacementLevel
): readonly string[] {
  const wrong: string[] = [];
  for (const entry of parseKeywordEntries(keywords)) {
    if (entry.kind !== "keyword") continue;
    const levels = levelsOf(ddsType, entry.name);
    if (levels === undefined) continue; // 判断しない
    if (!levels.includes(level)) wrong.push(entry.name.toUpperCase());
  }
  return wrong;
}

/** そのレベルの和名（指摘の文に出す）。 */
export function levelLabel(level: PlacementLevel): string {
  return level === "file" ? "ファイル" : level === "record" ? "レコード（様式）" : "フィールド（項目）";
}

/**
 * **キーワードを書けないレベルに書いている**行を報告する。
 *
 * 原典はキーワードごとに書ける場所（ファイル / レコード / フィールド）を定めており、
 * **違うレベルに書くと実機はコンパイルを通さない**。実機で確かめた
 * （IBM i 7.3 / `CRTDSPF`。7 通り。正しいレベルは通り、`DSPSIZ` を様式や項目に /
 * `OVERLAY` をファイルや項目に / `COLOR` を様式やファイルに置くと通らない）。
 *
 * **原典がレベルを書いていないキーワードは咎めない**（表に入っていない）。
 * 知らないものを咎めると、正しいソースを弾く。
 */
export function keywordLevelDiagnostics(
  lines: readonly string[],
  units: readonly LogicalUnit[],
  ddsType: KeywordLevelType
): { code: "keyword-wrong-level"; message: string; sourceLine: number }[] {
  const diagnostics: {
    code: "keyword-wrong-level";
    message: string;
    sourceLine: number;
  }[] = [];

  const report = (
    keywords: string,
    level: PlacementLevel,
    sourceLine: number
  ): void => {
    const names = keywordsNotAllowedAt(ddsType, keywords, level);
    if (names.length === 0) return;
    diagnostics.push({
      code: "keyword-wrong-level",
      message:
        `${names.join(" / ")} は${levelLabel(level)}・レベルに書けません` +
        "（原典がキーワードごとに書ける場所を定めています）。" +
        "実機はこの形をコンパイルしません",
      sourceLine
    });
  };

  // **ファイル・レベルは論理単位にならない**ので別の口から読む。
  for (const entry of fileLevelKeywordLines(lines)) {
    report(entry.keywords, "file", entry.sourceLine);
  }
  for (const unit of units) {
    report(unit.keywords, unit.kind === "record" ? "record" : "field", unit.sourceLine);
  }

  return diagnostics;
}
