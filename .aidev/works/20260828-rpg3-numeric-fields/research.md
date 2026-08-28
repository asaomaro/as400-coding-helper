# 調査: RPG III の残りの数値欄

## 調査の問い

- Q1: 対象の欄は実機で数字だけか。右寄せは必須か。
- Q2: 前 work が「通る土台が無い」と書いた形（外部記述の F 仕様）は何が原因だったか。
- Q3: E 仕様・L 仕様の定義は、そもそも消費経路に繋がっているか。

## 判明した事実

- **F1: コンパイル・リストはスプールから読める。** `QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC`
  で番号を引き、`host_get_spool` で本文が取れる。**桁ではない失敗の理由がその場で分かる**
  ので、これまでの「二分探索で切り分ける」が要らなくなった。
  前 work が理由不明で止めたのは、この経路に気付いていなかったため。
  （注: `CommandConnection` から返るのは `QRG0008 Severity level NN` までで、
  欄ごとの理由はリスト側にしか出ない。）

- **F2: 数字だけ・右寄せの欄**（対照つきで確認。英字も左詰めも通らない）:
  F `RECADDRLEN`(29-30) / `KEYSTART`(35-38)、O `SPACEBEFORE`(17) / `SPACEAFTER`(18) /
  `ENDPOS`(40-43)、E `ENTPERREC`(33-35) / `ENTPERTAB`(36-39) / `ENTLEN`(40-42) /
  `ENTLEN2`(52-54)、L `LINE1`(15-17) / `LINE2`(20-22)。
  スペース欄は `0`-`3` のみ（`4` は通らない）。

- **F3: スキップ欄は数字だけではない。** `QRG6016『The Skip entries are not
  01-99, A0-A9, B0-B2, or blank』`。**`A0` を流して通ることを確認**（前後とも）。
  `numericOnly` を付けると実機が受ける値を弾く。

- **F4: F 仕様の 20-23 / 47-52 / 60-65 / 67-70 / 73-74 は空白でなければならない**
  （`QRG2016`）。定義が入力欄を持つ `BLOCKLEN`(20-23) と `SYMDEVICE`(47-52) が該当。
  境目は両側から確認した（47-52 は落ち、71-72 は通る）。

- **F5: 53 桁目は「ラベル」ではなく「継続」**（`QRG2067『The Continuation entry is
  not K or blank』`）。**`K` ＋ 54-59 `INFDS` ＋ 60-65 にデータ構造名の継続行が
  コンパイルを通ること**も確かめた（否定だけで決めていない）。

- **F6: L 仕様は 2 組しか使えない。** `QRG3049『Unused Line-Counter specification
  entries (positions 25-74) not blank』`。3 組目を直接置いて落ちることも確認。
  定義の `LINE3`〜`LINE12` / `CHANNEL3`〜`CHANNEL12`（20 欄）は実機では書けない。

- **F7: E 仕様・L 仕様は消費経路に繋がっていなかった。** `classifySpec` の switch に
  `E` / `L` が無く `undefined` に落ちる（`src/core/rpgSpec.ts`）。定義 JSON はあるのに
  **F4 も lint も一度も届いていなかった**。ILE 側には E/L の定義が無い（RPG IV で廃止）。

- **F8: 前 work が止まった原因は F 仕様の書き方ではなく `*LIBL`。**
  `CPF5715 File CUSTMAS in library *LIBL not found`。外部記述ファイルは
  コンパイル時に解決されるが、**コンパイル・ジョブは毎回別**なので `ADDLIBLE` が効かない。
  `*LIBL` に載る `QGPL` に置いたら解決し、リストに
  `EXTERNAL FORMAT CUSTREC RPG NAME CUSTREC` が出た。**F 仕様の桁は最初から合っていた。**

## 実装アンカー

- A1: 定義 — `vscode-extension/resources/prompter/rpg/rpg3/ja/{F,O,E,L}-SPEC.json`
- A2: 分類の switch — `vscode-extension/src/core/rpgSpec.ts`（`case "I": case "O":` の隣）
- A3: 検査 — `vscode-extension/src/lint/rules/numericField.ts`（`attributes.numericOnly` を見る）
- A4: テスト — `vscode-extension/test/unit/rpg3NumericColumns.test.ts`

## 実装時の注意

- **対照を必ず添える。** このバッチでも仕掛け側の誤りを 5 回踏んだ
  （L 仕様のチャネルに `CH`／継続の `K` をファイル行に置く／`OF` の行数が用紙長超え／
  E 仕様のテーブル未参照／C 仕様の結果標識を 57 桁に置く）。いずれも**桁の話ではない**。
- RPG III の定義は**原典が無いので手書き**。生成スクリプトは無く、JSON を直接直す。
