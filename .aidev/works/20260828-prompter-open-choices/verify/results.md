# 検証結果（2026-08-29）

| 検証 | 結果 |
|---|---|
| `npm test` | **1121 passing / 0 failing**（1118 から +3） |
| `npm run verify` | **19 検査すべて OK** |
| `node dev/prompter-e2e.mjs` | **62/62 PASS**（57 から +5） |
| `node dev/e2e.mjs`（DDS） | **182/182 PASS**（壊していない） |
| `npm run compile` / `compile:webview` | OK |
| `npm run test:integration` | **未実行**（`xvfb-run` が無い）→ CI |

## 後退を戻すと落ちることの確認

| 戻した後退 | 落ちた検査 |
|---|---|
| 自由入力をやめて常に `<select>` | 候補にすぎない欄は自由入力になる / 候補は一覧として見える（2 件） |
| 描画モデルに `restricted` を載せない | 同上（2 件） |
| **制限のある欄まで**自由入力にする | 制限のある欄は `<select>` のまま（1 件） |

3 つ目が要点——**変えすぎても落ちる**ようにしてある。
「候補にすぎない欄だけ」という範囲そのものを検査している。

## 受け入れ基準の対応

| AC | 確認 |
|---|---|
| AC1 一覧に無い値を打って確定できる | e2e: `ADDPFM` の `SRCTYPE` に `RPGLE` |
| AC2 打った値が書き戻しに乗る | e2e: 行に `SRCTYPE(RPGLE)` が出る |
| AC3 候補が一覧として見える | e2e: `#choices-SRCTYPE` の `<option>` |
| AC4 制限ありは `<select>` のまま | e2e ＋ 単体（`SHARE` は `restricted` が `false` でない） |
| AC5 既存が緑 | 上表 |
| AC-I1〜I5 | `<datalist>` は素の web の部品。I4 は既存の `focusMemo` が効く（連続入力の検査が既にある） |

## 変更の前提を数えて固定した

`restricted:false` の選択欄は **108 欄、うち 57 欄は選択肢が 1 つ**。
単体テストがこの件数を検査する——**動いたらこの変更の前提が変わっている**ので気付ける。

## 未検証の穴

- `npm run test:integration` は未実行。WebView の描画だけの変更で拡張ホストの経路に
  触れていないが、**CI の `integration` ジョブで確認する**。
