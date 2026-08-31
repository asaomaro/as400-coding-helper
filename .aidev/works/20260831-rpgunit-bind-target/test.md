# 検証結果: テスト対象のバインド

## 受け入れ基準

| AC | 結果 | 根拠 |
|---|---|---|
| **AC1** `--bnd` でビルド・実行できる | ✅ | `bind: CALCSRV` と表示され、ビルド 5.4s・実行 13.5s で完走 |
| **AC2** 正しい実装に対して合格 | ✅ | `SUCCESS 2 tests, 0 failure, 0 error`・終了 **0** |
| **AC3** **対象を壊すと落ちる** | ✅ | 下記 |
| **AC4** 実例一式がある | ✅ | `tools/example/` に 3 本 ＋ README（手順・壊し方つき） |
| **AC5** `--bnd` 省略で従来どおり | ✅ | `RUNOK.rpgle` が `SUCCESS 1 tests`・終了 **0** |
| **AC6** `--self-test` が通る | ✅ | 17 件（`--bnd` の 5 件を含む） |

## AC3: バインドが効いていることの証明

**テストを 1 文字も触らず、対象だけを壊した。**

```diff
- C   RETURN  %DEC(AMOUNT * (1 + RATE) : 11 : 2)
+ C   RETURN  %DEC(AMOUNT * RATE : 11 : 2)
```

対象を作り直して同じコマンドを叩いた結果:

```
  ✗ TESTROUND  TESTROUND (CALCTST->CALCTST:1000)
      Expected 105, but was 5.
  ✗ TESTTAX  TESTTAX (CALCTST->CALCTST:600)
      Expected 110, but was 10.

FAILURE  2 tests, 2 failure, 0 error        （終了コード 1）
```

**対象を戻すと緑に復帰**（`SUCCESS 2 tests, 0 failure`・終了 0）。実機に壊れた対象は残していない。

> **この検査が本体。** 通っているだけの実例は、バインドが効いていなくても
> （テストが自己完結なら）緑になる。落ちることまで見て初めて意味が出る。

## 実装中に見つけた欠陥 2 件（いずれも自分のもの）

1. **`BNDSRVPGM` の書式を間違えた。** 修飾を空白区切りにして `(ASAOLIB CALCSRV)` と
   書き、2 要素として読まれてビルドが落ちた。原典（`RPGUNIT/QCMD,RUCRTRPG`）を読むと
   `QUAL` が 2 段で **`library/name`**。スラッシュを保つのが正しい。
2. **`SBMJOB` の成否を見ていなかった。** 1 の誤りで投入自体が失敗していたのに、
   道具は「ビルド失敗」とだけ言い、**本当の理由が消えていた**（スプールも出ない）。
   ビルド・実行の両方で投入の戻りを見るようにした。

2 は 1 が無ければ気付かなかった。**自分の誤りが道具の穴を炙り出した**形。

## 後始末

| 見たもの | 結果 |
|---|---|
| 壊した対象 | **戻して緑を確認済み** |
| IFS の作業ファイル | 道具が `finally` で削除（`CALCPR.src` / `CALCSRV.src` も削除） |
| 残ジョブ | 無し |
| 実機に残るもの | `CALCSRV`（*MODULE / *SRVPGM）・`CALCTST` *SRVPGM・`QUNITSRC` のメンバー |

スプールは消していない（規約）。

## 判定

**全 6 件の受け入れ基準を満たしている。差し戻しは無し。**
