# 検証結果（2026-08-29）

| 検証 | 結果 |
|---|---|
| `npm test` | **1118 passing / 0 failing**（1110 から +8） |
| `npm run verify` | **19 検査すべて OK**（プロンプター往復 538 定義を含む） |
| 実機（IBM i 7.3 / `CRTRPGPGM`） | 候補 50 語 ＋ 対照 8 件を判定。**対照は 2 巡とも 4/4** |
| 桁の書き戻し | `buildRpgLineText` で 53=`K` / 54-59=`INFDS` / 60-65=`FDS` を確認 |
| 継続行の分類 | `classifyRpgSpecKeyword` が継続行も `F-SPEC` に分類（F4 が開く） |

## 後退を戻すと落ちることの確認

AGENTS.md「落ちないテストは何も守っていない」。**4 件すべてで落ちた。**

| 戻した後退 | 落ちた件数 |
|---|---|
| 条件表示（`dependsOn`）を外す | 1 |
| 選択欄そのものを消す | 4 |
| 選択肢で縛る（`dropdown` 化） | 1 |
| 桁を重ねる（`CONTENTRY` を 60 → 59） | 2 |

## 実機の判定（AC1 / AC2）

- 1 巡目 30 語: 有効 10 / 無効 20。対照 4/4。
- 2 巡目 20 語: 有効 5 / 無効 15。対照 4/4。
- **有効 15 件**: `INFDS` `INFSR` `RECNO` `PLIST` `PASS` `PRTCTL` `SLN` `RENAME`
  `SFILE` `IGNORE` `SAVDS` `IND` `NUM` `ID` `COMIT`
- 生データ: `verify/options-result.json` / `verify/options-result-round2.json`

**「有効」は不在証明ではない。** 15 件中 14 件は `QRG2023` の代わりに
**その語を名指しする別のメッセージ**が出ている（`verify/probe-msgsummary.mjs` で本文を確認）。

## 未検証の穴

- **`npm run test:integration` は未実行**（`xvfb-run` が無い）。ただし本 work は
  **定義 JSON だけの変更**でコードに触れていないため、拡張ホストの経路に影響しない。
  CI の `integration` ジョブで確認する。

## 実機の片付け（2026-08-29）

`verify/cleanup.mjs` で確認・削除した。

| | 結果 |
|---|---|
| 6 時間以内に作ったオブジェクト（`ASAOLIB`） | **0 件** |
| IFS の作業ファイル | **0 件** |
| スプール | **71 件を削除して 0 件** |

**probe の `DLTSPLF` は書式を誤っていた。** `JOB()` に
`075010/ASAO/QPRTJOB#957` のように `#番号` を付けており、
`.catch(() => {})` で握り潰されていたため 71 件が残っていた。
正しくは `JOB(番号/ユーザー/名前) SPLNBR(番号)`。

**握り潰しは静かに溜まる。** 片付けは「呼んだ」ではなく
**「残っていないこと」を数えて確かめる**。
