import conditioningData from "../../../resources/completion/dds-conditioning.json";
import { parseKeywordEntries } from "./ddsKeywords";

/**
 * **そのキーワードにオプション標識を付けられるか。**
 *
 * DDS は条件が付く対象を「フィールド**または**キーワード」としているが、
 * **キーワードごとに可否が決まっている**。付けられないものに付けると、実機は
 * コンパイルを通さない（`CPF7311`。2026-08-27 / IBM i 7.3 で `EDTCDE` / `EDTWRD` /
 * `CHECK` を確認）。書けてしまうと、壊れたと気付くのは実機に持っていったとき。
 *
 * 表は原典の各キーワード詳細ページから生成する
 * （`docs/origin/generate-dds-conditioning.mjs`）。**ここが持つのは表の引き方だけ**で、
 * 可否を手で書かない（AGENTS.md）。`verify-dds-conditioning.mjs` が原典との一致に加えて
 * **実機で確かめた 5 件**とも突き合わせる。
 *
 * このモジュールは **vscode を import しない**。
 */

export type ConditionableDdsType = "DSPF" | "PRTF";

interface ConditioningFile {
  readonly keywords: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
}

const data = conditioningData as unknown as ConditioningFile;

/**
 * 引くための索引。**鍵を大文字に揃える。**
 *
 * 原典の総称は `CAnn` のように小文字を含むので、素の鍵と引く側で食い違う
 * （`"CAnn".toUpperCase()` は `CANN`）。片方だけ揃えると黙って引けなくなるので、
 * 表を読み込むときに揃えてしまう。
 */
const INDEX: Record<string, Record<string, boolean>> = Object.fromEntries(
  Object.entries(data.keywords).map(([kind, table]) => [
    kind,
    Object.fromEntries(
      Object.entries(table).map(([keyword, value]) => [keyword.toUpperCase(), value])
    )
  ])
);

/**
 * 付けられるか。**分からなければ `undefined`**。
 *
 * 原典が可否を書いていないキーワードがある（DSPF 17 / PRTF 1）。
 * 知らないものを「付けられない」と決めつけると、**実機で通るソースを咎める**ことになる
 * ——出すべきものを隠すより余分に出す方が害が少ない、の逆で、
 * ここは**黙っている方が害が少ない**（`generate-dds-keywords` の使用レベルと同じ考え方）。
 */
export function isConditionable(
  ddsType: ConditionableDdsType,
  keyword: string
): boolean | undefined {
  return INDEX[ddsType]?.[keyword.trim().toUpperCase()];
}

/**
 * キーワード欄のうち、**条件を付けられないもの**の名前。
 *
 * `nn` を含む総称（`CAnn` / `CFnn`）は、書かれている形（`CA03`）から総称へ正規化して引く
 * ——`ddsKeywords` の解説の引き方と同じ規則。
 */
export function unconditionableKeywords(
  ddsType: ConditionableDdsType,
  keywords: string
): string[] {
  const found: string[] = [];
  for (const entry of parseKeywordEntries(keywords)) {
    if (entry.kind !== "keyword") continue;
    const name = entry.name.toUpperCase();
    // 書かれた形で引けなければ、末尾の数字を `nn` に置き換えた総称で引く。
    const verdict =
      isConditionable(ddsType, name) ??
      isConditionable(ddsType, name.replace(/\d+$/u, "nn"));
    if (verdict === false && !found.includes(name)) found.push(name);
  }
  return found;
}
