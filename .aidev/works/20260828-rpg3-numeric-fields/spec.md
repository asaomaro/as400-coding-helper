# 仕様: RPG III の残りの数値欄

## 設計方針

前 work と同じ形にそろえる——**`attributes.numericOnly` を立て、根拠を `help` に書く**。
`numericOnly` は「数字だけ」の検査と「書き戻しの右寄せ(`padStart`)」の両方を担うので、
**右寄せが必須でない欄には付けない**。

実機で分かったことのうち、**入力欄が実機の通らない形を誘う**もの（空白必須の桁・
名前が違う欄）は、欄を消さずに `help` で警告する。消すと既存ソースを読み込んだときに
その桁が画面に出ず、**書き戻しで黙って消える**（PJ が繰り返し踏んでいる形）。

## 対象範囲

- `resources/prompter/rpg/rpg3/ja/{F,O,E,L}-SPEC.json`
- `src/core/rpgSpec.ts`（E / L の分類を足す）
- `test/unit/rpg3NumericColumns.test.ts`
- `docs/src/RPG3SAMP.rpg`（O/F 仕様の桁ずれ。lint が指摘するようになるため）

## 振る舞いの詳細

| 欄 | 桁 | 対応 |
|---|---|---|
| F `RECADDRLEN` / `KEYSTART` | 29-30 / 35-38 | `numericOnly` |
| O `SPACEBEFORE` / `SPACEAFTER` / `ENDPOS` | 17 / 18 / 40-43 | `numericOnly` |
| E `ENTPERREC` / `ENTPERTAB` / `ENTLEN` / `ENTLEN2` | 33-35 / 36-39 / 40-42 / 52-54 | `numericOnly` |
| L `LINE1` / `LINE2` | 15-17 / 20-22 | `numericOnly` |
| O `SKIPBEFORE` / `SKIPAFTER` | 19-20 / 21-22 | **付けない**。受ける集合を help に |
| F `BLOCKLEN` / `SYMDEVICE` | 20-23 / 47-52 | 空白必須を help に。既定で隠す |
| F `LABELS` → `CONTINUATION` | 53 | 名前と説明を実機に合わせる |
| L `LINE3`〜`CHANNEL12` | 25-74 | 空白必須を help に |

## エラー処理 / 異常系

`numericOnly` の欄が空欄なら指摘しない（必須かどうかは別の規則）。行が短くて欄が
存在しない場合も、**固定長のレコードは空白で埋められる**ので「左詰め」と判定する
（前 work で入れた扱いをそのまま使う）。

## 受け入れ基準との対応

- AC1: `verify/probe-*.mjs` 6 本。全件に対照を置き、対照が落ちたら結果を読まない。
- AC2/AC3: 上表のとおり。スキップ欄は付けない。
- AC4: 各 `help` に `QRG****` のメッセージ ID を書く。
- AC5: `classifySpec` に `E` / `L` を足し、**分類そのものを見るテスト**で確かめる。
- AC6: `RPG3SAMP.rpg` の桁を定義どおりに直す。
