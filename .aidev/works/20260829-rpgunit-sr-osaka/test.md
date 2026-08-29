# 検証結果: RPGUnit を SR-OSAKA に導入する

## 受け入れ基準

| AC | 結果 | 根拠 |
|---|---|---|
| **AC1** 導入され主要オブジェクトが揃う | ✅ | `RSTLIB`: `CPC3703 32 objects restored`。`RPGUNIT` に `RUCALLTST`/`RUCRTRPG`/`RUCRTTST`/`CMPMOD`/`UPDLIB` (*CMD) と `RUTESTCASE` (*SRVPGM) |
| **AC2** 固定長で `/COPY` してコンパイルできる | ✅ | 下記「対照つきの結果」 |
| **AC3** `RUCRTRPG` でテストが作れる | ✅ | `FIXTST2 *SRVPGM` が `ASAOLIB` に作成された |
| **AC4** `RUCALLTST` で合否が区別される | ✅ | `2 test cases, 2 assertions, 1 failure, 0 error.` |
| **AC5** 出力形式が記録されている | ✅ | 下記「`RUCALLTST` の出力」 |
| **AC6** 片付けてある | ✅ | IFS 作業ファイル 10 件を `RMVLNK`、`ASAOLIB/RPGUNIT6`（使えない v6）を `DLTF`、`MSGW` のジョブを `ENDJOB`。残ジョブ 0 件 |

## 対照つきの結果（AC2）

**対照を置いたことが誤読を止めた。** 最初の試行は本命も対照も落ちており、
「固定長だから落ちた」ではなく「両方に共通の原因がある」と分かった
（真因は `TESTCASE` の入れ子の非修飾 `/include` で、`RPGUNIT` が `*LIBL` に無かった）。

ライブラリー・リストを整えた後:

```
対照 **free : RNS9305 Module FREETST placed in library ASAOLIB. 00 highest severity.
本命 固定長 : RNS9305 Module FIXTST  placed in library ASAOLIB. 00 highest severity.
```

使った固定長ソース（H/P/D/C 仕様のみ。`**free` を 1 行も含まない）:

```
     H NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)
      /COPY RPGUNIT/QINCLUDE,TESTCASE
     PTESTPASS         B                   EXPORT
     DTESTPASS         PI
     C                   CALLP     iEqual(2:2)
     PTESTPASS         E
     PTESTFAIL         B                   EXPORT
     DTESTFAIL         PI
     C                   CALLP     iEqual(2:3)
     PTESTFAIL         E
```

`RPGUNIT/QINCLUDE,TESTCASE` は 775 行で **1 行目が `**free`**。
それでも固定長の主ソースから `/COPY` して通る。

## `RUCALLTST` の出力（AC5）

スプール名は **`RPGUNIT`**（`QSYSPRT` ではない）。1 ページ。

```
*** Tests of FIXTST2 ***
Date        : 2026-08-29 / 19:43:36
Job         : 148937/ASAO/RUNTST3
User        : ASAO
iRPGUnit    : v4.0.3
IBM i       : V7R3M0
Cur. library: *CRTDFT
Library list:   10 RPGUNIT
                20 ASAOLIB
                30 QGPL
                40 QTEMP
TESTFAIL - FAILURE
Expected 2, but was 3.
  TESTFAIL (FIXTST2->FIXTST2:900)
-----------------------
FAILURE. 2 test cases, 2 assertions, 1 failure, 0 error.
```

後段（CI・自動化）が読むべき点:

- **集計行が最後**（`FAILURE.` / `n test cases, n assertions, n failure, n error.`）。
  成功時は `SUCCESS.` になる想定。
- **失敗は `<手続き名> - FAILURE` ＋ 期待値/実際値 ＋ `(pgm->module:SEQNBR)`**。
  `900` は SEU の行番号なので、`OPTION(*SRCSTMT)` を付けていれば元ソースに戻せる。
- **例外経路は別**。失敗があると `RUCALLTST` は `CPF9897` の escape を投げる
  （設計書 4.2 / 7 章 #2 の想定どおり。EVFEVENT とは別経路）。

## 実機に残したもの（報告）

| 場所 | もの | 扱い |
|---|---|---|
| `RPGUNIT` | iRPGUnit v4.0.3.r の 31 オブジェクト | **本体。残す** |
| `ASAOLIB/RPGUNIT` | v4.0.3.r の SAVF（4.9MB） | 入れ直し用に残す |
| `ASAOLIB/QUNITSRC` | 検証ソース（`FIXTST`/`FREETST`/`FIXTST2`/`RUDRV`/`RUDRV2`） | 再現用に残す |
| `ASAOLIB/FIXTST2` | 固定長テストのサービスプログラム | 残す |
| `ASAOLIB/RUDRV`,`RUDRV2` | コンパイル用 CL driver | 残す |
| スプール | `RPGUNIT#3` ほか、作業で出た十数件 | **消していない**（他の作業の証跡を巻き込まないため） |

**`ASAOLIB` は 130 → 135 オブジェクト**（増えたのは上記 5 件）。

## 判定

**全 6 件の受け入れ基準を満たしている。** 併せて、依存項目
「固定長（P 仕様書）で RPGUnit テストが書けることを実機確認する」も**この検証で満たされた**。
