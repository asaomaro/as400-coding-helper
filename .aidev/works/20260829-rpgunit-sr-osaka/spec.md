# 仕様: RPGUnit を SR-OSAKA に導入する

## 概要

iRPGUnit **v4.0.3.r** を SR-OSAKA（IBM i 7.3）に**既定ライブラリー名 `RPGUNIT`** で導入し、
固定長のテストケースで動作を確認する。SAVF の置き場所は `ASAOLIB`（利用者指定）。

## 設計方針

### 1. バージョンは v4.0.3.r（最新ではない）

最新 v6.0.2.r は `RSTLIB` は通るが、`RUCRTRPG` が `CRTRPGMOD … TGTCCSID(…)` を発行し、
**7.3 の `CRTRPGMOD` に `TGTCCSID` が無い**ため使えない（research F4）。
`TGTRLS(V7R3M0)` は保存形式の互換であって、コマンドが使うキーワードの互換ではない。

### 2. ライブラリー名は既定の `RPGUNIT` にする

`ASAOLIB` は**既に 130 オブジェクトが入っている稼働中の検証ライブラリー**
（`AS400_LIB` として PJ の実機検証に使っている）。ここに RPGUnit を混ぜると
後から切り分けて消せない。**SAVF の置き場所が `ASAOLIB`、展開先は `RPGUNIT`** と分ける。
既定名なので `UPDLIB` も再コンパイルも不要（research F5）。

### 3. 転送はホストサーバー経由（IFS → `CPYFRMSTMF`）

FTP は使わない。`IfsConnection.writeFile` でバイト列を IFS に置き、
`CPYFRMSTMF … CVTDTA(*NONE)` で SAVF オブジェクトに載せる。
**ファイルの中身を会話に載せずに済む**（5MB を base64 で渡すと context を潰す）。

### 4. 検証は必ず対照を置く

固定長の可否を見るときは `**free` 版を並べて走らせる。片方だけ見ると、
共通の原因（ライブラリー・リスト不足など）を「固定長が原因」と誤読する。

### 5. 長時間・非対話への備え

- `CommandConnection.connect({ timeoutMs: 120000 })`（既定 20 秒では足りない）。
- コンパイルは `SBMJOB … INLLIBL(RPGUNIT …) INQMSGRPY(*DFT)`。
  `INQMSGRPY(*DFT)` が無いと関数チェックが照会になり **ジョブが `MSGW` で残る**。
- CL 中の RPGUnit コマンドは `RPGUNIT/` で**修飾する**（解決はコンパイル時）。

## 対象範囲

実機（SR-OSAKA）のみ。リポジトリのコードは変更しない。成果物は工程文書と、
実機に残る `RPGUNIT` ライブラリー・`ASAOLIB` の検証オブジェクト。

## 振る舞いの詳細

```
[ローカル] v4 SAVF ──IfsConnection.writeFile──> /home/ASAO/RPGUNIT.SAVF
                                                      │ CPYFRMSTMF CVTDTA(*NONE)
                                                      ▼
                                            ASAOLIB/RPGUNIT (*FILE savf)
                                                      │ RSTLIB SAVLIB(RPGUNIT)
                                                      ▼
                                            RPGUNIT ライブラリー（32 オブジェクト）
                                                      │
   固定長 .rpgle ──CPYFRMSTMF──> ASAOLIB/QUNITSRC ──RPGUNIT/RUCRTRPG──> FIXTST2 *SRVPGM
                                                      │ RPGUNIT/RUCALLTST
                                                      ▼
                                            スプール RPGUNIT（テスト結果）
```

## エラー処理 / 異常系

| 事象 | 扱い |
|---|---|
| `RSTLIB` が `CPF3283`/`CPF3756`（別版が残っている） | `CLRLIB` してから入れ直す。`DLTLIB` は `CPF2113` で通らないことがある |
| `DLTLIB` が `CPF2113` | `QZRCSRVS` の事前開始ジョブが `*SHRRD` を保持。**他人のジョブを落とさず `CLRLIB` で足りる** |
| ジョブが `MSGW` | `INQMSGRPY(*DFT)` を付ける。残ってしまったら `ENDJOB … OPTION(*IMMED)` |

## 受け入れ基準との対応

| AC | 満たし方 |
|---|---|
| AC1 | `RSTLIB` 後に `OBJECT_STATISTICS('RPGUNIT','*ALL')` で主要オブジェクトを数える |
| AC2 | 固定長と `**free` の 2 本を `CRTRPGMOD` に通し、**両方の結果**を見る |
| AC3 | `RPGUNIT/RUCRTRPG` で `FIXTST2 *SRVPGM` を作る |
| AC4 | 合格 1・失敗 1 のテストを書き、`RUCALLTST` の集計が `1 failure` になることを見る |
| AC5 | 出力スプールを読み、書式を `test.md` に写す |
| AC6 | IFS の作業ファイルと不要な SAVF を消す。**スプールは残して名前を報告する** |
