import { findFieldReferences, findRecordReferences } from "./ddsReferences";
import type { OutlineRecord } from "./dspfOutline";

/**
 * **このファイルの中に無い名前を指しているキーワード**を集める。
 *
 * ## なぜ要るか
 *
 * 様式を消すと、それを指していた `SFLCTL(EMPDTL)` や、中の項目を指していた
 * `CSRLOC(CSRROW CSRCOL)` が**宙に浮く**。改名（`renameRecord`）は参照も一緒に直すが、
 * 削除では直しようが無い——消えた名前に書き換える先が無い。
 *
 * ## 直さずに知らせる
 *
 * **黙って書き換えない。** 参照を勝手に外したり別の名前に付け替えたりすると、
 * 何が起きたのか原因が掴めなくなる。ここは**見つけて検証タブに出すだけ**で、
 * どうするかは書いた人が決める。
 *
 * ## 規則は `ddsReferences` が持つ
 *
 * 「どのキーワードのどの引数が名前か」は原典から起こした表が唯一の真実
 * （`RECORD_ARGUMENTS` / `FIELD_ARGUMENTS` ＋ `&名前` の規則）。ここでは**その結果を使うだけ**で、
 * 判定を写さない。外部のオブジェクトを指す引数（`REF` / `MSGID` / `FONTNAME` …）は
 * `NOT_FOLLOWED` が除いているので、ここへは来ない。
 */

export type DanglingReferenceCode =
  | "record-reference-not-found"
  | "field-reference-not-found";

export interface DanglingReference {
  readonly code: DanglingReferenceCode;
  readonly message: string;
  /** 1 始まり。参照が書かれている欄の**代表行**（一覧・プロパティと同じ鍵）。 */
  readonly sourceLine: number;
}

/** 走査するキーワード欄 1 つ分。代表行と、結合済みのキーワード欄。 */
interface KeywordArea {
  readonly sourceLine: number;
  readonly keywords: string;
}

/**
 * 宙に浮いた参照を集める。**モデルが既に持っているものだけ**で判定する。
 *
 * 生の行ではなく `outline` / `fileKeywords` を受けるのは、キーワード欄の**結合**
 * （継続行をまたぐ `CSRLOC(ROW +` / `COL)` の形）が済んだものがそこにあるため。
 * 物理行を自分で走査すると、行をまたいだ参照を取りこぼす。
 */
export function findDanglingReferences(
  outline: readonly OutlineRecord[],
  fileKeywords: readonly KeywordArea[]
): readonly DanglingReference[] {
  const recordNames = new Set<string>();
  const fieldNames = new Set<string>();
  const areas: KeywordArea[] = [];

  for (const entry of fileKeywords) {
    areas.push({ sourceLine: entry.sourceLine, keywords: entry.keywords });
  }
  for (const record of outline) {
    // 名前の無い束（最初の様式より前の項目）は様式ではないので名前を登録しない。
    if (record.name.length > 0) recordNames.add(record.name.toUpperCase());
    areas.push({ sourceLine: record.sourceLine, keywords: record.keywords });

    for (const item of record.items) {
      // **定数には名前が無い。** 名前を持つのはフィールドだけ。
      const name = item.attributes.name;
      if (name !== undefined && name.length > 0) fieldNames.add(name.toUpperCase());
      areas.push({ sourceLine: item.sourceLine, keywords: item.attributes.keywords });
    }
  }

  const found: DanglingReference[] = [];
  for (const area of areas) {
    if (area.keywords.trim().length === 0) continue;

    for (const reference of findRecordReferences(area.keywords)) {
      if (recordNames.has(reference.name.toUpperCase())) continue;
      found.push({
        code: "record-reference-not-found",
        message: `${reference.keyword} が指す様式 ${reference.name.toUpperCase()} がありません`,
        sourceLine: area.sourceLine
      });
    }

    for (const reference of findFieldReferences(area.keywords)) {
      if (fieldNames.has(reference.name.toUpperCase())) continue;
      found.push({
        code: "field-reference-not-found",
        message:
          `${reference.keyword} が指すフィールド ${reference.name.toUpperCase()} がありません`,
        sourceLine: area.sourceLine
      });
    }
  }

  // 行の順に並べる（検証タブはソースを追いながら読むもの）。
  return [...found].sort((a, b) => a.sourceLine - b.sourceLine);
}
