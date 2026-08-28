# 調査: 候補つき自由入力をどう作るか

## 調査の問い

- Q1: 一覧つき自由入力の作り方。VSCode の WebView で動くか。
- Q2: `restricted` は画面まで届いているか。
- Q3: 影響する欄はどれくらいあるか。既存の振る舞いを変えてしまう欄は無いか。
- Q4: 検証（`validate`）側は既に正しいか。

## 判明した事実

### F1: `<datalist>` は**この画面で既に使っている**（確かめ済みの手段）

オブジェクト名の候補が `<input list="objects-file">` ＋ `<datalist>` で出ている
（`src/prompter/webview/ui.ts` の `buildTextInput` と `rebuild` の datalist 生成）。

- 単体テストがある（`test/unit/cdmlRules.test.ts`「オブジェクト欄に候補が紐づく」）。
- **e2e がブラウザで実際に確かめている**（`dev/prompter-e2e.mjs`
  「欄に候補が紐づく（定義に objectKind があるだけでは死蔵）」）。
- VSCode 側でも出荷済み。

→ **Q1 は解決済み。新しい手段を持ち込む必要がない**（同じ画面に 2 通りの
「候補の出し方」を作らない）。

### F2: `restricted` は描画モデルに載っていない

`SerializableField`（`src/prompter/formModel.ts`）に `restricted` が無い。
`toSerializableState` も詰めていない。**画面からは判断できない状態。**

`maxLength` / `allowsVariable` / `objectKind` は同じ `attributes` から載せているので、
**並びに 1 つ足すだけ**で済む（前例のある形）。

### F3: 影響する欄は 108。**過半数は選択肢が 1 つ**

`resources/prompter/{cl,cmd}/{ja,en}` を数えた（2026-08-29 実測）。

| 選択肢の数 | 欄数 |
|---|---|
| 1 | **57** |
| 2 | 41 |
| 3 | 6 |
| 10 | 2 |
| 11 | 2 |
| **合計** | **108** |

**選択肢 1 つの `<select>` は選択ではなく錠前。** 57 欄はいま実質入力できない。

`restricted` が未指定の欄（＝制限あり）は**この変更の対象外**なので、
`<select>` のまま。振る舞いは変わらない。

### F4: 検証側は既に正しい

`src/prompter/model.ts` の `validate()`:

```ts
if (parameter.attributes?.restricted !== false && parameter.options?.length > 0 && !isVariable) {
  // 列挙に無ければ「指定できない値です。」
}
```

`restricted:false` の欄では**この検査を通らない**——つまり任意の値が通る。
`test/unit/cdmlRules.test.ts` の「実機が受ける値を弾かない（全 CL 定義の総当たり）」が
これを全件で見張っている。**触る必要は無い。**

### F5: `withCurrentValue` と両立する

`toSerializableState` は「いまの値が選択肢に無ければ先頭に足す」
（`20260828-prompter-standalone` で入れた）。自由入力にしても**害にならない**——
既存の値が候補一覧の先頭に出るだけ。むしろ整合する。

### F6: `objectKind` との衝突は実データに無い

`buildTextInput` は `objectKind` を持つ欄に `list="objects-<kind>"` を付ける。
選択肢の候補も `list` を使うので、**両方を持つ欄があると 1 つしか付けられない**。

数えたところ **0 件**（`cl/ja` `cmd/ja` の全定義。group から降りてくる `objectKind` も
辿って数えた）。**実データでは衝突しない**が、増えたときに黙って片方が消えるのは困るので
**どちらを使うかは実装で明示する**（選択肢を持つ欄は選択肢を出す）。

## 影響範囲

- `src/prompter/formModel.ts` — `SerializableField` に `restricted` を足す。
- `src/prompter/webview/ui.ts` — `buildControl` の分岐と、候補の `<datalist>` 生成。
- テスト: `test/unit/prompterWebview.test.ts` / `dev/prompter-e2e.mjs`。
- ハーネス: `restricted:false` の欄を持つ定義を 1 つ足す（`ADDPFM`）。

## 実現性 / リスク

- **R1: `<datalist>` の id が衝突しうる。** オブジェクト候補は `objects-<kind>` で
  種類ごとに 1 つ。欄ごとの候補は**欄の名前**を鍵にする必要があり、
  入力欄名には `#`（繰り返しの連番）が入る。**id に使えない文字**ではないが、
  `querySelector("#...")` で引くときに壊れる。参照は `list` 属性経由なので
  引く必要は無いが、**id の作り方は決めておく**。
- **R2: 振る舞いを変える範囲を間違えると 108 欄が壊れる。**
  `restricted === false` の欄だけであることをテストで固定する。

## 実装アンカー

- A1: 入力部品の分岐 — `src/prompter/webview/ui.ts` の `buildControl`。
- A2: 候補一覧の生成 — 同 `rebuild()` の `datalists` の作り方（オブジェクト候補と同居）。
- A3: 描画モデル — `src/prompter/formModel.ts` の `SerializableField` と
  `toSerializableState` の `fields.map`（`maxLength` の隣）。
- A4: 検証（**触らない**）— `src/prompter/model.ts` の `validate()`。

## 実装時の注意

- **`buildTextInput` は既に `list` を 1 つ付けている**（`objectKind`）。
  同じ欄が `objectKind` と選択肢の**両方**を持つ場合、`list` は 1 つしか付けられない。
  どちらを優先するか決める（実データに両方持つ欄があるか数えてから決める）。
- 画面の作り分けを増やすと**読む単位が増える**。`buildControl` の分岐は
  「選択肢があって制限あり → select / それ以外 → 入力欄」に保つ。

## spec への申し送り

- `<datalist>` は既存の手段。**新しい仕組みを足さない。**
- 変えるのは `restricted === false` の欄だけ。**それ以外は 1 ピクセルも変えない。**
