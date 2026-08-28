# 仕様: 候補にすぎない選択欄を、一覧つき自由入力にする

## 概要

`restricted === false` かつ選択肢を持つ欄を、`<select>` から
**`<input list>` ＋ `<datalist>`** に変える。**それ以外の欄は 1 ピクセルも変えない。**

## 設計方針

### 1. 既にある手段を使う（新しい仕組みを足さない）

オブジェクト名の候補が既に `<input list>` ＋ `<datalist>` で動いている（research F1）。
単体テストと e2e があり、VSCode 側でも出荷済み。**同じ画面に 2 通りの候補の出し方を作らない。**

### 2. 分かれ目は 1 つだけ

```
選択肢がある かつ 制限あり(restricted !== false) → <select>（いままでどおり）
選択肢がある かつ 候補にすぎない(restricted === false) → <input list> ＋ <datalist>
選択肢がない → いままでどおり
```

`buildControl` の読む単位を増やさないため、**判定はこの 1 行に閉じる**。

### 3. `restricted` を描画モデルに載せる

`SerializableField` に `restricted?: boolean` を足し、`toSerializableState` が
`parameter.attributes?.restricted` をそのまま渡す。
`maxLength` / `allowsVariable` / `objectKind` と**同じ並び・同じ書き方**（research F2）。

**画面が独自に判断しない。** 「候補にすぎないか」を決めるのは定義（＝実機の `Rstd`）で、
画面はそれを見るだけ。

### 4. `datalist` の id

欄ごとに `choices-<入力欄名>`。入力欄名には繰り返しの連番（`#2`）が入りうるが、
**参照は `list` 属性の値としてだけ**なので `querySelector("#…")` で引かない
（引くと `#` がセレクタとして壊れる。research R1）。

### 5. `objectKind` と両方持つ欄

実データには **0 件**（research F6）。増えたときに黙って片方が消えないよう、
**選択肢を持つ欄は選択肢を出す**と実装で明示する。

## 対象範囲

| ファイル | 変更 |
|---|---|
| `src/prompter/formModel.ts` | `SerializableField.restricted` を足し、`toSerializableState` で詰める |
| `src/prompter/webview/ui.ts` | `buildControl` の分岐 ＋ 欄ごとの `<datalist>` 生成 |
| `test/unit/prompterWebview.test.ts` | 描画モデルに載ること・載せる範囲 |
| `dev/prompter-standalone.ts` | `ADDPFM` をサンプルに足す（`SRCTYPE` が該当欄） |
| `dev/prompter-e2e.mjs` | **一覧に無い値を打って確定できる**ことを画面で確かめる |

**変更しないもの**: `validate()`（既に正しい。research F4）、定義 JSON、
`restricted` の値そのもの。

## インターフェース / データ構造

```ts
export interface SerializableField {
  // …
  /**
   * 選択肢が「制限」か「候補」か。**`false` なら候補にすぎず、一覧に無い値も書ける**
   * （実機の `Rstd=NO`）。画面はこれを見て入力部品を変える。
   */
  readonly restricted?: boolean;
}
```

## 振る舞いの詳細

### 描画

`restricted === false` の欄:

```html
<input type="text" name="SRCTYPE" list="choices-SRCTYPE" value="…">
<datalist id="choices-SRCTYPE"><option value="*NONE"></option></datalist>
```

`<datalist>` は**その欄の近く**に置く（オブジェクト候補はフォーム上部にまとめているが、
あちらは種類ごとに 1 つで使い回すため。欄ごとの候補は使い回さない）。

### 幅と長さ

`buildTextInput` の既存の規則をそのまま使う——`size` は `min(maxLength, 40)`、
`maxlength` は `max(maxLength, 11)`（**CL 変数の余地**。PR#98 の後退を戻さない）。

### 値の出入り

`collectValues()` は `input[name]` を見るので**そのまま動く**。
`refresh()` の `applyAllowedValues` は `<select>` のときだけ効く実装なので、
自由入力になった欄では選択肢の出し入れをしない——**相関で絞られた値の検査は
コアの `validate()` が `allowedValues` で行う**ので、画面側の絞り込みは不要。

## ドメイン固有の考慮

- **「列挙した値＝制限とは限らない」**（AGENTS.md）。この変更はその原則を
  **画面にも通す**もの。定義と検証は既に従っており、画面だけが遅れていた。
- **57 欄は選択肢が 1 つ**しかない（research F3）。選択肢 1 つの `<select>` は錠前で、
  その欄は実質入力できなかった。

## エラー処理 / 異常系

- 一覧に無い値を打っても**画面は咎めない**。妥当性はコアの `validate()` が決める
  （`restricted:false` なら通る、`allowedValues` で絞られていれば咎める）。
- 選択肢が空配列なら、いままでどおり普通の入力欄。

## 受け入れ基準との対応

- **AC1 / AC2**: e2e で `ADDPFM` の `SRCTYPE` に `RPGLE` を打ち、**確定した値**と
  **書き戻される行**に出ることを確かめる。
- **AC3**: `<datalist>` に候補が並ぶことを e2e で確かめる。
- **AC4**: `restricted` 指定の無い欄が `<select>` のままであることを e2e と単体で固定。
- **AC5**: `npm test` / `npm run verify` / e2e 2 本。
- **AC-I1〜I5**: `<datalist>` は素の web の部品なので開閉・キーボードは既定どおり。
  I4（描き直しでフォーカスが外れない）は既存の `focusMemo` が効く——e2e で確かめる。
