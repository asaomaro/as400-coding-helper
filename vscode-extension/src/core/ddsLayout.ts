/**
 * DDS（A 仕様書）の桁と、17 桁目の名前タイプの意味を **単一の真実**として提供する。
 *
 * キーワード補完（レベルの絞り込み）とアウトライン（シンボルの階層）が同じ規約を共有し、
 * 片方だけに種別追加が漏れる（ドリフト）のを防ぐ。specClassifier が RPG 仕様書に対して
 * 果たしている役割の DDS 版。
 *
 * 桁は resources/navigation/dds-keyword-columns.json（docs/origin/generate-dds-columns.mjs が
 * 原典から生成したもの）と同じ値。ルーラー・プロンプターと食い違わせないため、
 * ここで独自に桁を決めない。
 */

/** 桁（1 始まり、終端を含む）。dds-keyword-columns.json の 14 欄のうち、名前と属性に使うもの。 */
export const DDS_COLUMNS = {
  /** 7 桁目。`*` なら注記行。 */
  comment: [7, 7],
  /** 17 桁目。名前または仕様のタイプ（R / K / S / O / J / H）。 */
  nameType: [17, 17],
  /** 19-28 桁。名前。 */
  name: [19, 28],
  /** 29 桁目。参照（`R`）。 */
  reference: [29, 29],
  /** 30-34 桁。長さ。 */
  length: [30, 34],
  /** 35 桁目。データ・タイプ。 */
  dataType: [35, 35],
  /** 36-37 桁。小数点以下桁数。 */
  decimals: [36, 37],
  /** 38 桁目。使用目的。 */
  usage: [38, 38],
  /** 39-44 桁。位置（表示装置・印刷装置のみ意味を持つ）。 */
  position: [39, 44]
} as const;

export type DdsColumn = readonly [number, number];

/** 桁を取り出す。行が短くても空文字になるだけで例外にならない。 */
export function ddsField(text: string, column: DdsColumn): string {
  return text.slice(column[0] - 1, column[1]);
}

/**
 * 注記行（7 桁目が `*`）は桁の意味を持たない。
 *
 * 原典（`物理ファイルおよび論理ファイルの注記 (7 桁目)`）は**ブランク行も注記として
 * 扱う**と書いているが、それはこの関数に含めていない（`isDdsBlankLine` を別に持つ）。
 * 「注記か」と「定位置として読めるか」は用途によって答えが違うため:
 *
 *   - **補完**は空行でも候補を出したい。まだ何も打っていない新しい行こそ補完が要る。
 *     ここでブランク行まで弾くと、新規行でキーワード補完が出なくなる。
 *   - **lint** は空行を検査対象から外したい（欄が書かれていないだけで誤りではない）。
 *
 * そこで**素の判定をそれぞれ 1 つずつ**持ち、組み合わせ方は利用側で決める。
 * 判定そのものを写さなければドリフトはしない。
 */
export function isDdsCommentLine(text: string): boolean {
  return ddsField(text, DDS_COLUMNS.comment) === "*";
}

/**
 * ブランク行（7-80 桁に文字が無い）。原典はこれも注記として扱う。
 * 定位置として読む側（lint）は `isDdsCommentLine` と併せて使う。
 */
export function isDdsBlankLine(text: string): boolean {
  return text.slice(6, 80).trim().length === 0;
}

/**
 * DDS の使用レベル。キーワードはどのレベルで書けるかが決まっている。
 * 例: DSPSIZ はファイル・レベル、OVERLAY はレコード・レベル、COLOR はフィールド・レベル。
 */
export type DdsLevel =
  | "file"
  | "record"
  | "field"
  | "key"
  | "join"
  | "select"
  | "help";

/**
 * 名前タイプ欄（17 桁目）の値 → レベル。
 *
 * S（選択）と O（省略）は同じ select に寄せている。どちらもレコードの絞り込み条件で、
 * 書けるキーワードもアウトライン上の位置も同じため。
 */
const NAME_TYPE_LEVEL: Readonly<Record<string, DdsLevel>> = {
  R: "record",
  K: "key",
  S: "select",
  O: "select",
  J: "join",
  H: "help"
};

/** 17 桁目の値からレベルを求める。空・未知なら undefined。 */
export function levelFromNameType(nameType: string): DdsLevel | undefined {
  return NAME_TYPE_LEVEL[nameType.trim().toUpperCase()];
}

/** その行の 17 桁目が示すレベル。空・未知なら undefined。 */
export function levelOfLine(text: string): DdsLevel | undefined {
  return levelFromNameType(ddsField(text, DDS_COLUMNS.nameType));
}

/** その行の名前欄（19-28 桁）。 */
export function ddsName(text: string): string {
  return ddsField(text, DDS_COLUMNS.name).trim();
}
