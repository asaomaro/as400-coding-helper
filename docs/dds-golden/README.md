# 実機ゴールデンの採取手順

`packages/dds-core` の ASCII レンダラが**実機の画面と一致する**ことを検証するための、
ゴールデン（実機の画面キャプチャ）を採る手順。

> **CI は実機に繋がない。** 採取済みのゴールデンと比較するだけ。
> 実機を使うのは**ゴールデンを新規に採る／更新するとき**だけ。
> 実機を CI の必須依存にすると、実機が落ちた日に全テストが落ちる。

## 何をゴールデンにするか

`ts5250` の `get_screen` が返すグリッドをそのまま保存する。

| 事実（実測で確定） | 内容 |
|---|---|
| 行の長さ | **各行きっかり 80 文字**（24 行） |
| 全角文字 | **1 文字ぶんのセルを占め、次のセルは空白** |
| SO / SI | **空白**（可視文字にならない） |
| 属性バイト | **空白** |

**加工しない。** レンダラ側を実機の形式に合わせてある。
キャプチャを加工してゴールデンにすると、**加工の側にバグが入っても気付けない**。

## フィールドの値をどう揃えるか（重要）

レンダラはフィールドを**プレースホルダ**（英数字→`X` / 数値→`9`）で描く。
一方、実機の画面には**実行時の値**が出る。そのままでは必ず食い違う。

**CL ドライバでフィールドにプレースホルダと同じ値を書き込む**ことで揃える。

- 英数字フィールド → `'XXXXX'`（長さぶんの `X`）
- 数値フィールド → `9999`（桁数ぶんの `9`）

**ここを間違えると比較が落ちる。** 実際に一度踏んだ（`Y` を入れて不一致になった）。

## 手順

### 1. 一時ソースファイルを作る

DBCS を含む DDS を置くので **CCSID 5035** が要る。既存の `QDDSSRC` は 1027（SBCS）なので使えない。

```
CRTSRCPF FILE(<LIB>/AIDVSRC5) RCDLEN(112) CCSID(5035) TEXT('aidev golden temp')
```

### 2. DDS と CL ドライバを転送する

リポジトリの `packages/dds-core/test/fixtures/golden-*.dspf` と `golden-*-driver.clp` を使う。

```
（IFS へ書く: host_write_file で /tmp/aidv_ga.dspf, /tmp/aidv_ga.clp）

CPYFRMSTMF FROMSTMF('/tmp/aidv_ga.dspf')
           TOMBR('/QSYS.LIB/<LIB>.LIB/AIDVSRC5.FILE/AIDVGA.MBR')
           MBROPT(*REPLACE) STMFCCSID(1208) DBFCCSID(*FILE)
```

**`DBFCCSID` は `*FILE` にする。** 数値で指定するとファイルの CCSID と食い違って失敗する。

### 3. コンパイルする

```
CRTDSPF   FILE(<LIB>/AIDVGA)   SRCFILE(<LIB>/AIDVSRC5) SRCMBR(AIDVGA)   REPLACE(*YES)
CRTCLPGM  PGM(<LIB>/AIDVGACL)  SRCFILE(<LIB>/AIDVSRC5) SRCMBR(AIDVGACL) REPLACE(*YES)
```

**数値フィールド（35 桁目が `S` 等）には小数桁（36-37 桁）が必須。**
省くと `CPD7408` でコンパイルが落ちる（これも一度踏んだ）。

### 4. 対話セッションで実行してキャプチャする

```
open_session(system: "<system>", screenSize: "24x80")
signon(sessionId, system)          # サインオン情報画面が出る
send_key(Enter)                    # メインメニューへ
send_key(Enter, fields: [{ row:20, col:7, value:"CALL <LIB>/AIDVGACL" }])
                                   # → 対象の画面が表示される。ここが採取対象
send_key(F3)                       # プログラムを終了（CA03 で抜ける）
close_session(sessionId)
```

**`SNDRCVF` は入力待ちで止まる。** F3 で必ず抜けてからセッションを閉じること。
抜けずに閉じるとジョブが残り、次回の採取が失敗する。

### 5. ゴールデンとして保存する

`get_screen` の各行（`NN| ` の接頭辞を除いた部分）を 80 文字に右詰めし、
24 行を改行で連結して `packages/dds-core/test/golden/<name>.screen.txt` に置く。

**行末の空白も含めてそのまま保存する。** トリムしない。

### 6. 実機を元に戻す

```
DLTPGM PGM(<LIB>/AIDVGACL)
DLTF   FILE(<LIB>/AIDVGA)
DLTF   FILE(<LIB>/AIDVSRC5)
RMVLNK OBJLNK('/tmp/aidv_ga.dspf')
RMVLNK OBJLNK('/tmp/aidv_ga.clp')
DLTSPLF ...   （コンパイルリストを出した場合）
```

**採取のたびに必ず片付ける。** 一時オブジェクトを残さない。

## 検証

`npm run test -w @as400/dds-core` の `golden.test.ts` が、
レンダラの出力とゴールデンを**文字単位**で比較する。**実機は要らない。**

不一致のときは「何行目の何桁目がどう違うか」が出る。
80×24 を丸ごと出しても原因が分からないため。
