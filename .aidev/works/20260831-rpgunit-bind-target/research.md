# 調査: テスト対象のバインド

**手を動かして確かめた**（文書だけでは組み立てられない部分だったため、
research の段で実機に通してから spec を固めた）。

## 調査の問い

- **Q1**: プロトタイプ（`/COPY`）はどこに置き、どう解決させるか。
- **Q2**: テスト対象のサービスプログラムは `EXPORT(*ALL)` で足りるか。
- **Q3**: `RUCRTRPG` の `BNDSRVPGM` の書式は。

## 判明した事実

### F1: プロトタイプは同じソース PF のメンバーで足りる（Q1）

`CALCPR` をソース PF のメンバーに置き、対象とテストの両方が
`/COPY QUNITSRC,CALCPR` で引く。**修飾しない**のが実務の書き方。

**ただし `*LIBL` に解決を頼るので、ビルドするジョブのライブラリー・リストが要る。**
`CommandConnection` は 1 コマンド 1 ジョブなので、素で `CRTRPGMOD` を叩くと落ちる。

```
CPF4102  File QUNITSRC in library *LIBL with member CALCPR not found.
RNS9308  Compilation stopped. Severity 40 errors found in program.
```

→ **対象のビルドも `SBMJOB … INLLIBL(<lib> QGPL QTEMP)` で組む。**

### F2: `EXPORT(*ALL)` で足りる（Q2）

```
CRTSRVPGM SRVPGM(<lib>/CALCSRV) MODULE(<lib>/CALCSRV) EXPORT(*ALL) REPLACE(*YES)
→ CPC5D0B Service program CALCSRV created in library ASAOLIB.
```

バインダー言語（`*SRCFILE`）は要らない。

### F3: `BNDSRVPGM` は `MAX(50)` のリストで、修飾は `library/name`（Q3）

原典（`RPGUNIT/QCMD,RUCRTRPG`）:

```
PARM  KWD(BNDSRVPGM) TYPE(BNDSRVPGM) MAX(50) PROMPT('Bind service program')

BNDSRVPGM:  QUAL TYPE(*NAME) LEN(10) DFT(*NONE) SPCVAL(*NONE)
            QUAL TYPE(*NAME) LEN(10) DFT(*LIBL) SPCVAL(*LIBL) PROMPT('Library')
```

`QUAL` が 2 段（名前・ライブラリー）なので **`library/name`**。
**空白区切りにすると 2 つの要素として読まれる**——最初の実装でここを間違えた
（`(ASAOLIB CALCSRV)` と書いてビルドが落ちた）。

### F4: 署名が変わらなければ、対象を差し替えるだけでテストは新しい実装を見る

対象の手続き本体だけを壊して作り直し、**テストを触らずに**回すと落ちた。

```
Expected 110, but was 10.     ← AMOUNT * (1 + RATE) を AMOUNT * RATE にした
Expected 105, but was 5.
```

`EXPORT(*ALL)` の輸出一覧が変わらないので署名が同じ。**テストを作り直さなくても効く。**

## 実現性 / リスク

- **実現性は確かめ済み**（research の段で通した）。
- **リスク: 「通ったこと」に意味を持たせるには壊す検査が要る。** バインドの指定を
  間違えていてもテストが自己完結なら緑になる。**対象を壊して落ちることまで見る。**

## 実装アンカー

- **A1**: `RUCRTRPG` への引き渡し（`tools/run-rpgunit.mjs` の `SBMJOB CMD(RPGUNIT/RUCRTRPG …)`）
- **A2**: 引数解析（同 `parseArgs`）と `--self-test`
- **A3**: 実例の置き場所（`tools/example/` を新設）

## spec への申し送り

- `--bnd` は**繰り返し可**（`MAX(50)`）。ライブラリー省略時は `AS400_LIB` で補う。
- **対象のビルドは道具の外**（利用者の資産）。README で `SBMJOB` ＋ `INLLIBL` を案内する。
- **壊す検査を受け入れ基準に入れる**（AC3）。
