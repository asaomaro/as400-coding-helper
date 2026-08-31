# 実例: テスト対象をバインドして単体テストする

**実機で通したものだけを置いている**（`20260831-rpgunit-bind-target`）。
対象を壊すとテストが落ちることまで確かめてある。

| ファイル | 役割 |
|---|---|
| `CALCPR.rpgle` | **プロトタイプ**。テスト対象とテストの両方が `/COPY` する |
| `CALCSRV.rpgle` | **テスト対象**のサービスプログラム（`addTax`） |
| `CALCTST.rpgle` | **テスト**。`CALCSRV` をバインドして `addTax` を呼ぶ |

## 何を示しているか

単体テストの本体は「**テスト対象をテスト・サービスプログラムにバインドし、
その手続きを直接呼ぶ**」こと。`iEqual(2:2)` のような自己完結のテストは
RPGUnit が動くことしか示さない。

## 手順

### 1. テスト対象を作る（利用者側の仕事。道具はここに関与しない）

3 本のうち `CALCPR` と `CALCSRV` をソース PF のメンバーに入れてから:

```
SBMJOB CMD(CRTRPGMOD MODULE(<lib>/CALCSRV) SRCFILE(<lib>/QUNITSRC) SRCMBR(CALCSRV)
             REPLACE(*YES))
         JOB(TGTBLD) INLLIBL(<lib> QGPL QTEMP) INQMSGRPY(*DFT)
CRTSRVPGM SRVPGM(<lib>/CALCSRV) MODULE(<lib>/CALCSRV) EXPORT(*ALL) REPLACE(*YES)
```

- **`SBMJOB` ＋ `INLLIBL` で組む。** `/COPY QUNITSRC,CALCPR` を**修飾していない**ので、
  ソース PF が `*LIBL` に居るジョブでないと `CPF4102` になる（実機で踏んだ）。
  修飾しないのは、実務のソースがそう書かれているから。
- **`EXPORT(*ALL)` で足りる**（バインダー言語は要らない）。実機で確認済み。
- テストは **V2 の `assertEqual`** で書く（設計書 4.2）。旧 `iEqual` は型で丸めるため
  **誤った期待値を隠す**——`iEqual(105 : addTax(100 : 0.055))` は通ってしまうが、
  実際の戻りは `105.50` で `assertEqual` なら落ちる。

### 2. テストを回す

```
node tools/run-rpgunit.mjs tools/example/CALCTST.rpgle --bnd CALCSRV
```

```
▸ 転送     CALCTST.rpgle → ASAOLIB/QUNITSRC(CALCTST)  [RPGLE]  bind: CALCSRV
▸ ビルド   CALCTST … OK (5.4s)
▸ 実行     CALCTST … 2 tests, 0 failure (13.5s)

SUCCESS  2 tests, 0 failure, 0 error
```

## テストが本当に対象を見ていることの確かめ方

**これをやらないと、通っていることに意味が無い。** 対象だけを壊して、
テストを触らずに回す。

```
- C   RETURN  %DEC(AMOUNT * (1 + RATE) : 11 : 2)
+ C   RETURN  %DEC(AMOUNT * RATE : 11 : 2)          ← 1 + を落とす
```

対象を作り直して（テストは再ビルドするが中身は不変）同じコマンドを叩くと:

```
  ✗ TESTROUND  TESTROUND (CALCTST->CALCTST:1000)
      Expected 105, but was 5.
  ✗ TESTTAX  TESTTAX (CALCTST->CALCTST:600)
      Expected 110, but was 10.

FAILURE  2 tests, 2 failure, 0 error        （終了コード 1）
```

**署名（`EXPORT(*ALL)` の輸出一覧）が変わらなければ、対象を差し替えるだけで
テストは新しい実装を見る。** テストを作り直さなくても落ちる。
