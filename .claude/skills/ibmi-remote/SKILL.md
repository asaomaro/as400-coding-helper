---
name: ibmi-remote
description: IBM i 実機への転送・コンパイル・エラー取得を ssh で行う。「実機にコンパイルして」「ソースを転送して」「コンパイルエラーを見て」などのとき、または AI の自律ループ（編集→転送→コンパイル→修正）を回すときに使用する。
allowed-tools: [Bash, Read, Write]
---

IBM i 実機（pub400 等）へ ssh で到達し、**ソースメンバーの送受信・コンパイル・
コンパイルエラーの構造化取得**を行う PJ 固有 skill。設計書
`docs/workflow/ibmi-dev-workflow.md` の 4.1（AI の自律ループ）の実行手段。

**ここに載っているコマンド列はすべて pub400（IBM i 7.5）で実行を確認済み**
（2026-07-19）。未確認のものは「未確認」と明記してある。

## 前提

- 資格情報は**環境変数のみ**。コマンド引数・コミット・設定ファイルへの平文は禁止。
  - `PUB400_USER` / `PUB400_PASSWORD`（`sshpass -e` は `SSHPASS` を読む）
- 接続: `pub400.com` ポート **2222**（22 ではない）
- 共用機のため**大量バッチを流さない**。繰り返しコンパイルは自ライブラリ内で完結させる。

## 0. 接続の確認

```sh
export SSHPASS="$PUB400_PASSWORD"
sshpass -e ssh -o StrictHostKeyChecking=no -p 2222 "$PUB400_USER@pub400.com" 'system "DSPLIBL"'
```

ログインバナーが毎回 stdout に出る。判定に使う出力を汚すので、必要なら次で落とす:

```sh
| grep -vE "WELCOME|Please take|do not disturb|other users|limited support|all access|see https|^\*+ ?\*?$|^ $|Enter your password|^\* "
```

## 1. 送信（ローカル → ソースメンバー）

**IFS の一時パスへ scp → `CPYFRMSTMF` でメンバーへ**の 2 段。

```sh
export SSHPASS="$PUB400_PASSWORD"
sshpass -e scp -o StrictHostKeyChecking=no -P 2222 \
  MYPGM.rpgle "$PUB400_USER@pub400.com:/home/$PUB400_USER/"

sshpass -e ssh -o StrictHostKeyChecking=no -p 2222 "$PUB400_USER@pub400.com" \
  "system \"CPYFRMSTMF FROMSTMF('/home/$PUB400_USER/MYPGM.rpgle') \
   TOMBR('/QSYS.LIB/<LIB>.LIB/QRPGLESRC.FILE/MYPGM.MBR') MBROPT(*REPLACE) STMFCCSID(1208)\""
```

**ソースタイプは別途設定する**（コピーだけでは付かない）:

```sh
system "CHGPFM FILE(<LIB>/QRPGLESRC) MBR(MYPGM) SRCTYPE(RPGLE)"
```

ソース物理ファイルが無ければ先に作る（既存なら `CPF5813` が出るだけで無害）:

```sh
system "CRTSRCPF FILE(<LIB>/QRPGLESRC) RCDLEN(112) TEXT('RPGLE source')"
```

## 2. コンパイル

**`OPTION(*EVENTF)` を必ず付ける**（付けないと EVFEVENT が作られず、手順 3 が使えない）。

```sh
system "CRTBNDRPG PGM(<LIB>/MYPGM) SRCFILE(<LIB>/QRPGLESRC) SRCMBR(MYPGM) \
        OPTION(*EVENTF) REPLACE(*YES)"
```

構文検査だけしたい場合は `OPTION(*NOGEN)` を足す（オブジェクトを作らない）。
**DDS には `*NOGEN` が無い**ので QTEMP への実コンパイルで代替する。

## 3. コンパイルエラーの構造化取得

**`CPYTOSTMF` で EVFEVENT メンバーを取り出す。SQL は使わない。**

> **なぜ SQL でないか（実機で確認済み）**: vscode-ibmi は EVFEVENT を SQL で
> SELECT するが、あれは mapepire という SQL クライアントを持っているからできる。
> ssh だけの経路では結果セットを受け取れない。実機で 3 通り試した結果:
> - `RUNSQLSTM` で SELECT → **`SQL0084 SQL statement not allowed`**（DDL/DML 専用）
> - PASE の `/usr/bin/db2` → **`cannot open for reading`**（一般ユーザーに実行権限なし）
> - `CPYTOSTMF` → **成功**
>
> なお `CREATE ALIAS QTEMP.X FOR <LIB>.EVFEVENT(<MBR>)` 自体は成功する
> （`SQL7994`）。将来 SQL クライアントを持つなら SQL 経路も使える。

```sh
sshpass -e ssh -o StrictHostKeyChecking=no -p 2222 "$PUB400_USER@pub400.com" \
  "system \"CPYTOSTMF FROMMBR('/QSYS.LIB/<LIB>.LIB/EVFEVENT.FILE/MYPGM.MBR') \
   TOSTMF('/home/$PUB400_USER/MYPGM.evf') STMFOPT(*REPLACE) STMFCCSID(1208)\""

sshpass -e scp -o StrictHostKeyChecking=no -P 2222 \
  "$PUB400_USER@pub400.com:/home/$PUB400_USER/MYPGM.evf" .
```

生の中身はこの形（1 行 = 1 レコード）:

```
TIMESTAMP  0 20260719115735
PROCESSOR  0 000 1
FILEID     0 001 000000 028 MAROBENI1/QRPGLESRC(EVFTEST) 20260719115721 0
ERROR      0 001 1 000006 000006 005 000006 016 RNF7030 S 30 048 The name or indicator UNDEFIN... is not defined.
FILEEND    0 001 000008
```

## 4. エラーの解析（IBM 公式パーサー）

自前で解析しない。`@ibm/ibmi-eventf-parser`（IBM 公式・Apache-2.0）を使う。

```sh
npm i @ibm/ibmi-eventf-parser
```

```js
const { Parser } = require("@ibm/ibmi-eventf-parser");
const lines = require("fs").readFileSync("MYPGM.evf", "utf8").split(/\r?\n/);
let i = 0;
const p = new Parser();
p.parse({ readNextLine: () => lines[i++] });   // ISequentialFileReader

for (const e of p.getAllErrors()) {
  console.log(`${e.getFileName()} :${e.getStartErrLine()} ` +
              `桁${e.getTokenStart()}-${e.getTokenEnd()} ` +
              `[${e.getMsgId()}] ${e.getSevChar()}${e.getSevNum()} ${e.getMsg()}`);
}
```

**メソッド名に注意**（`getStartLine` ではない）:
`getRecordType` `getVersion` `getFileId` `getFileName` `getAnnotClass` `getStmtLine`
**`getStartErrLine`** `getTokenStart` `getEndErrLine` `getTokenEnd` `getMsgId`
`getSevChar` `getSevNum` `getLength` **`getMsg`**

出力例:

```
MAROBENI1/QRPGLESRC(EVFTEST) :6 桁5-16 [RNF7030] S30 The name or indicator UNDEFIN... is not defined.
MAROBENI1/QRPGLESRC(EVFTEST) :0 桁0-0  [RNS9308] T50 Compilation stopped. Severity 30 errors found in program.
```

重大度は `getSevNum()` で判定する（`30` 以上が致命。`T50` は打ち切り）。

## 5. 受信（ソースメンバー → ローカル）

送信の逆。

```sh
system "CPYTOSTMF FROMMBR('/QSYS.LIB/<LIB>.LIB/QRPGLESRC.FILE/MYPGM.MBR') \
        TOSTMF('/home/<USER>/MYPGM.rpgle') STMFOPT(*REPLACE) STMFCCSID(1208)"
# → scp で取得
```

**CCSID**: 非 UTF-8 のソースファイルでは `STMFCCSID(1208)` に加えて
`DBFCCSID(<ソースファイルの CCSID>)` の指定が要る（vscode-ibmi は QTEMP 経由の
2 段変換をしている）。**DBCS を含む場合は未確認**。

## 引用符の扱い（実際に踏んだ罠）

`ssh 'system "CL ..."'` は**引用符が 3 層**（ローカル shell / ssh / CL）になる。
CL 文字列の中に `'` が要る場合、ローカルで単引用符を使うと壊れる。

- **ローカル側は二重引用符**にし、CL の内側は `\"` でエスケープする（本書の例の形）
- パス引数（`FROMSTMF` 等）は CL 側で単引用符が必須。
  `'/home/x/y'` を素直に書けるよう、外側を二重引用符にしておく
- 複雑になったら **SQL/CL をファイルに書いて転送**し、`RUNSQLSTM SRCSTMF('...')` で
  実行する（この経路も確認済み。ただし SELECT は通らない）

## 未確認事項

以下は本書では確認していない。使う前に確かめること。

- **DBCS を含むソースの送受信**（CCSID 変換の正しさ）
- **RPGUnit**（`RUCRTRPG` / `RUCALLTST`）の導入と実行 → backlog P1
- **固定長（P 仕様書）での RPGUnit テスト**のコンパイル → backlog P2
- `RUCALLTST` の結果出力の形式

## 参照

- 設計書: `docs/workflow/ibmi-dev-workflow.md`（4.1 自律ループ / 6 章 安全規則）
- 調査: `.aidev/works/20260719-ibmi-dev-workflow/research.md`（F1・F8）
