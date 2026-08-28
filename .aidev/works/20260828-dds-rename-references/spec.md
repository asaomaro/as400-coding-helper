# 仕様: 名前変更の参照追随

## 概要

項目の名前を変えたとき、**同じソースの中でその項目を指しているキーワードの引数**も
一緒に書き換える。指す先が外部のものは触らない。

## 設計方針

### 1. 参照の見つけ方は 2 本立て

| 規則 | 対象 | 表が要るか |
|---|---|---|
| **A: `&名前`** | プログラム - システム間フィールド | **要らない**（一律） |
| **B: 定位置の引数** | `CSRLOC(1,2)` / `HLPARA(*FLD, 2)` | 要る（原典の引用つき） |

A が要らないのは、原典が `&` を「このソースの中のフィールド」の印として
一貫して使うため（`research.md` F1）。表を持つと**書き漏らしたキーワードで
黙って追随しない**が、A は書き漏らしようがない。

### 2. 表は手で書き、**網羅を検査で見張る**

原典の散文から機械的には決まらないので、表は手で書く。そのかわり:

- 各行に**原典の引用**を添える（何を根拠にそう決めたかが表の中に残る）。
- `verify-dds-references.mjs` が、**原典の syntax に名前らしい引数を持つのに
  表にも「触らない」一覧にも無いキーワード**を見つけたら落とす。
  新しいキーワードが増えたときに、判断を書くまで通らない。

### 3. 様式（レコード）の参照は**入れない**

`SFLCTL` / `ERASE` / `PASSRCD` / `MNUBARDSP` / `MNUBARCHC` / `HLPRCD` は
原典上「このファイル内の様式」だが、**デザイナに様式を改名する手段が無い**ので
到達しない（`research.md` F4）。backlog に起票する。

ただし**「触らないと決めた一覧」には入れる**——検査(2)が「判断していない」と
区別できるようにするため。

## 対象範囲

- 新規 `src/core/dds/ddsReferences.ts`
- `src/core/dds/ddsEdit.ts` — `setAttributes` の `name` に追随を足す
- `src/dds/webview/ui.ts` — 断り書きの訂正と件数の通知
- 新規 `docs/origin/verify-dds-references.mjs` ＋ `npm run verify` に追加

## インターフェース / データ構造

```ts
/** キーワード欄の中の、名前を指している 1 か所。 */
export interface DdsNameReference {
  /** キーワード名（大文字）。 */
  readonly keyword: string;
  /** 参照している名前（原文のまま。`&` は含まない）。 */
  readonly name: string;
  /** キーワード欄の中での位置（0 始まり・`end` は含まない）。 */
  readonly start: number;
  readonly end: number;
  /** `&` 付きか。書き戻しで `&` を残すために要る。 */
  readonly ampersand: boolean;
}

/** キーワード欄から、**このソースの項目**を指している箇所を集める。 */
export function findFieldReferences(keywords: string): readonly DdsNameReference[];

/** 参照している名前を置き換えたキーワード欄。一致が無ければ元のまま。 */
export function renameFieldReferences(
  keywords: string,
  from: string,
  to: string
): string;
```

## 振る舞いの詳細

### 引数の切り出し

キーワードは `parseKeywordEntries` で切れるが、**引数までは切れない**。
括弧の中を、引用符の外の空白で切る（`DFT('A B')` を割らない）。

### 一致の見方

**引数を切ってから丸ごと一致**で見る（大文字小文字は無視）。
文字列置換にすると `&CUSTNO2` の中の `CUSTNO` を壊す（AC5）。

### 追随の範囲

`toLogicalUnits` の全単位 ＋ `fileLevelKeywordLines`。
`CSRLOC` は様式のキーワードなので、項目だけを見ると取りこぼす（AC4）。

### 編集の組み立て

`setAttributes`（`name` あり）を受けたら、`applyDdsEdits` が
**同じ確定の中で**参照の行にも `setKeywords` 相当の書き換えを積む。
別の編集にしない——1 回の確定で名前と参照が揃っていないと、
途中で拒否されたときの状態が説明できない（`DdsEdit` の既存の方針）。

## ドメイン固有の考慮

- **`&` 付きの引数は様式名ではない**（`MNUBARDSP` の 2 つ目の形式。`research.md` F3）。
  今回は項目しか追わないので直接は効かないが、表の作りとして守る。
- **`HLPARA` は形式で意味が変わる**。`*FLD` のときだけ 2 つ目が項目名。

## エラー処理 / 異常系

- 参照の書き換えで 80 桁を超えたら `foldKeywordArea` が折る（既存）。
- 折っても収まらない場合は既存の `line-too-long` で断る。**名前の変更ごと断る**
  ——名前だけ変わって参照が古いままより、変わらない方がよい。

## 受け入れ基準との対応

- AC1: 規則 A。
- AC2: 規則 B（`CSRLOC` / `HLPARA`）。
- AC3: 表にも `&` にも当たらないので触らない。**外部を指す代表例を単体で固定**する。
- AC4: 走査が全単位 ＋ ファイル・レベル。
- AC5: 引数を切ってから丸ごと一致。
- AC6: 実機で `CRTDSPF` に通す（`verify/`）。
- AC-I1: `send` の応答で件数をステータスに出す。
- AC-I2: 断り書きを「様式の改名は追随しない」に直す。
