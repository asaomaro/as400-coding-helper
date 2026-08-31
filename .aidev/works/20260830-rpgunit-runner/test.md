# 検証結果: RPGUnit ランナー

## 受け入れ基準

| AC | 結果 | 根拠 |
|---|---|---|
| **AC1** 1 コマンドで通り結果が出る | ✅ | `RUNOK.rpgle` → 転送・ビルド・実行が各段の表示つきで完走 |
| **AC2** `SRCMBR` の制約を意識せずに済む | ✅ | メンバー名を常にプログラム名にした（`--srcmbr` を出さない）。self-test で既定値の解決を確認 |
| **AC3** SQLRPGLE も同じ入口 | ✅ | `RUNSQL.sqlrpgle` が `[SQLRPGLE]` と判定されて通った |
| **AC4** 合格 0 / 失敗 1 | ✅ | `RUNOK`→**0**、`RUNNG`→**1** |
| **AC5** IFS に作業ファイルが残らない | ✅ | 実行後に `RUN*.src` / `RUN*.xml` が **0 件** |
| **AC6** `--xml` で JUnit XML を保存 | ✅ | `runok.xml` に保存され `<testsuite>` として妥当 |
| **AC7** 失敗の内訳が出る | ✅ | `✗ TESTBAD  TESTBAD (RUNNG->RUNNG:900)` ＋ `Expected 2, but was 3.` |
| **AC8** ビルド失敗でスプール名とジョブ名 | ✅ | `RUNBAD #1 JOB(151901/ASAO/RUBH39NC)` / `QPJOBLOG #2` |

## 実機で回した 5 通り

| 入力 | 期待 | 実際 |
|---|---|---|
| `RUNOK.rpgle`（合格のみ） | 0 | **0** `SUCCESS 1 tests, 0 failure, 0 error` |
| `RUNNG.rpgle`（失敗あり） | 1 | **1** `FAILURE 2 tests, 1 failure, 0 error` |
| `RUNSQL.sqlrpgle` | 0 | **0** `[SQLRPGLE]` と判定 |
| `RUNBAD.rpgle`（ビルド失敗） | 2 | **2** ＋ スプール名 |
| 前提不足（環境変数なし） | 2 | **2** ＋ 足りない名前の列挙 |

補助: `--help` → **0**、存在しないソース → **2**。

## `--self-test`（実機なし・13 件）

```
引数の解決            7 件 ✓（--pgm 省略・拡張子 → SRCTYPE・--srctype の優先・大文字化 …）
summarize             6 件 ✓（件数・ケース数・message・本文の &gt; 復元・合格ケース・自己終了タグ）
self-test OK
```

**`summarize` のテストには実機が実際に出した XML を使っている**（作り物で通さない）。

## 後始末

| 見たもの | 結果 |
|---|---|
| IFS の `RUN*.src` / `RUN*.xml` | **0 件** |
| 残っているジョブ（`RUB*` / `RUR*`） | **0 件** |
| 作られた `*SRVPGM` | `RUNOK` / `RUNNG` / `RUNSQL`（`RUNBAD` は意図どおり未作成） |

`*SRVPGM` とソースメンバーは再実行の材料として**残す**（設計どおり）。
スプールは**消していない**（規約）。

## 検証中に見つけた自分のミス

前提不足の確認で `MODULE_NOT_FOUND` のクラッシュが出たが、**道具の欠陥ではなく
テスト側の誤り**だった——`cd /workspaces/ts5250` が残ったまま相対パス
`tools/run-rpgunit.mjs` を渡していた。絶対パスで叩き直したところ、
設計どおり「足りないものの列挙 ＋ 終了コード 2」が出た。

## 判定

**全 8 件の受け入れ基準を満たしている。差し戻しは無し。**
