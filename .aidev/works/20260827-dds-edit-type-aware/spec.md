# 仕様: 編集の検証に DDS の種別を渡す

## 設計方針

**任意引数にしない。** 渡し忘れた側で黙って検査が消えるのが、この PJ が
繰り返し踏んでいる形（AGENTS.md「拡張子を足したら『発火条件』まで足す」）。
**必須の引数**にして、渡し忘れをコンパイルエラーにする。

型は `DdsType` そのものではなく **`EditableDdsType = "DDS-DSPF" | "DDS-PRTF"`** に絞る。
`.pf` / `.lf` は配置の概念が無く、編集の対象になりえない——受け取れる形にすると
「PF を編集しようとしたらどうなるか」を考え続けることになる。

## 対象範囲

- `src/core/dds/ddsEdit.ts` — 引数と 2 つの検査
- 呼び出し 3 か所: `src/dds/editorProvider.ts` / `src/cli/dds.ts` / `dev/standalone.ts`
- 単体テスト 7 ファイル

## インターフェース / データ構造

```ts
export type EditableDdsType = "DDS-DSPF" | "DDS-PRTF";

export function validateDdsEdits(
  lines: readonly string[],
  edits: readonly DdsEdit[],
  ddsType: EditableDdsType
): readonly DdsEditRejection[];

export function applyDdsEdits(
  lines: readonly string[],
  edits: readonly DdsEdit[],
  ddsType: EditableDdsType
): readonly DdsEditResult[];
```

新しい拒否コード: `column-one-reserved`（`resolveDspfLayout` の診断コードと**同じ名前**にする
——同じ規則なので、利用者が突き合わせられる方がよい）。

## 振る舞いの詳細

### 1 桁目（画面ファイルだけ）

原典（`表示装置ファイルの桁数 (30 - 34 桁目)`）:
> フィールドは、表示画面の最初の桁を占めることはできません。
> **最初の桁は属性文字のために予約されています**。
> 例えば 24 x 80 の画面で、符号付き数字フィールドについて、39 - 41 桁目 (行) に 1 を、
> 42 - 44 桁目 (桁) に 1 を指定したとすると、フィールドは 1 行目の 1 桁目から
> 始まってしまうことになり、したがってこの指定は無効です。

`move` / `moveColumn` / `add` の桁が 1 のとき、**画面ファイルなら断る**。
帳票は断らない（印刷装置ファイルの位置の節に 1 桁目の制限は無く、属性文字も無い）。

### 行送り（帳票だけ）

`row-from-spacing` は帳票のときだけ見る。画面ファイルには `SPACE` / `SKIP` が無く、
行番号が空の項目はそもそも配置されない（`missing-position`）。

## ドメイン固有の考慮

- 拒否コード名を診断コードと**そろえる**。同じ原典の規則なので、
  別の名前にすると「同じことを 2 つの名前で言っている」状態になる。
- CLI の「指摘の増分で断る」仕掛けは**残す**。あちらは 1 桁目に限らず
  はみ出しや画面サイズなど**あらゆる**新しい指摘を見ており、こちらより広い。

## エラー処理 / 異常系

断ったときは何も書かない（`applyDdsEdits` が空を返す）。既存と同じ。

## 受け入れ基準との対応

- AC1/AC2: `validateColumnOne`（種別で分岐）
- AC3: 必須引数（TypeScript が渡し忘れを弾く）
- AC4: `validateRowMove` を帳票だけに
- AC5: 3 つの呼び出し元を直す（`resolveDdsType` / 拡張子から得た種別を渡す）
