# 計画: F 仕様 継続行の選択欄・記入欄を足す

## 実装方針

定義 JSON に 2 欄を足すだけ。**コードは変えない**（桁の書き戻しも条件表示も既存の仕組みに乗る）。
確かめるのは「桁が重ならない」「条件表示が効く」「往復で桁が崩れない」の 3 つ。

## 作業順序と依存関係

1. `F-SPEC.json` に `CONTOPT`(54-59) / `CONTENTRY`(60-65) を足す（依存: なし）
2. `CONTINUATION` の `placeholder` を `S` → `K` に直す（依存: なし。現状の誤り）
3. 単体テストを足す（依存: 1, 2）
4. `npm test` / `npm run verify` で往復を確かめる（依存: 3）

## リスク / 留意点

- **R1: `dependsOn` が RPG III 定義で初めて使われる。** CL 側では動いているが、
  RPG の経路（`positionResolver` → `buildInitialState`）で効くかは確かめる。
  効かなければ**欄が常に出る**だけで壊れはしないが、それでは条件表示の意味が無い。
- **R2: 桁の重なりは静かに壊れる。** 片方に入力すると他方が壊れ、読み戻しも曖昧になる
  （AGENTS.md）。**全欄の桁範囲が重ならないことをテストで固定する。**
- **R3: 一覧が「全部」に見えると害になる。** help の書き方で、
  **確かめた語であって網羅ではない**ことを明示する。

## テスト方針

| 見るもの | どこで |
|---|---|
| 桁が重ならない（20 → 22 欄） | `test/unit/rpg3NumericColumns.test.ts` に追加 |
| `CONTINUATION=K` のときだけ出る | 同上（`buildInitialState` の `visible`） |
| 値が入っていれば隠さない | 同上 |
| 往復で桁が崩れない | `npm run verify` の `verify-prompter-roundtrip`（全 538 定義） |
| 定義の構造が妥当 | `npm run verify` の `validate-prompter-defs` |
