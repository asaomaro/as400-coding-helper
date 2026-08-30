---
name: ibmi-remote
description: IBM i 実機への転送・コンパイル・エラー取得・コンパイルリストの読み取り。ssh（pub400）と hostserver ライブラリ（SR-OSAKA。Node から直接）の 2 経路。「実機にコンパイルして」「ソースを転送して」「コンパイルエラーを見て」「実機で桁を確かめて」などのとき、または AI の自律ループ（編集→転送→コンパイル→修正）を回すときに使用する。
allowed-tools: [Bash, Read, Write]
---

IBM i 実機（pub400 等）へ ssh で到達し、**ソースメンバーの送受信・コンパイル・
コンパイルエラーの構造化取得**を行う PJ 固有 skill。設計書
`docs/workflow/ibmi-dev-workflow.md` の 4.1（AI の自律ループ）の実行手段。

**ここに載っているコマンド列はすべて pub400（IBM i 7.5）で実行を確認済み**
（2026-07-19）。未確認のものは「未確認」と明記してある。

## どちらの経路を使うか

**2 通りある。機械で決まる。**

| 機械 | 経路 | 理由 |
|---|---|---|
| **pub400**（共用機・IBM i 7.5） | **ssh**（本書 1〜5 節） | ホストサーバーのポートが開いていない |
| **SR-OSAKA**（自機・IBM i 7.3） | **hostserver ライブラリ**（本書 6 節） | Node から直接叩ける。ssh より速く、スプールも SQL も同じ経路で読める |

**いまこの PJ の実機検証はほぼ SR-OSAKA / hostserver 経路**（DDS の桁・RPG III の
桁属性・F 仕様の継続行…）。pub400 は共用機なので、**大量に流す検証は SR-OSAKA で行う**。

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

## 4.5 コンパイル・リストを読む（DDS の解決結果を見る）

DDS には `*EVENTF` の他に**もっと直接的な観測手段**がある。`CRTDSPF` のコンパイル・リストの
**`Expanded Source`** には、**解決後の定数が長さつきで**出る（継続行を結合した結果や、
参照フィールドの展開が読める）。画面を出すより速く、値がそのまま見える。

```sh
# スプール名は「メンバー名」。ジョブは QPRTJOB なので JOB(*) では取れない。
# QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC で JOB_NAME / FILE_NUMBER を引いてから:
system "CPYSPLF FILE(<MBR>) TOFILE(*TOSTMF) JOB(<job>) SPLNBR(<n>) \
        TOSTMF('/home/<USER>/<MBR>.lst') STMFOPT(*REPLACE) WSCST(*NONE)"
```

**`TOFILE(*TOSTMF)` である**（`*STMF` は `CPD0078` で弾かれる）。
取り出したファイルは**ジョブの CCSID（EBCDIC）**で、行末も EBCDIC の `NL`(0x15) なので、
UTF-8 として読むと 1 行に見える。**中身の CCSID で復号する**こと。

## 5. 受信（ソースメンバー → ローカル）

送信の逆。

```sh
system "CPYTOSTMF FROMMBR('/QSYS.LIB/<LIB>.LIB/QRPGLESRC.FILE/MYPGM.MBR') \
        TOSTMF('/home/<USER>/MYPGM.rpgle') STMFOPT(*REPLACE) STMFCCSID(1208)"
# → scp で取得
```

**CCSID**: 非 UTF-8 のソースファイルでは `STMFCCSID(1208)` に加えて
`DBFCCSID(<ソースファイルの CCSID>)` の指定が要る（vscode-ibmi は QTEMP 経由の
2 段変換をしている）。

**DBCS を含むソースは、ソース物理ファイルの CCSID を先に決める**（2026-08-27・
SR-OSAKA / IBM i 7.3 で確認）。`CRTSRCPF FILE(x) RCDLEN(112)` の既定は
**CCSID 1027（日本語 SBCS のみ）**になり、そこへ `CPYFRMSTMF … STMFCCSID(1208)` で
全角を入れると**黙って空白に落ちる**——コンパイルは通り、画面には何も出ない。

```sh
system "CRTSRCPF FILE(<LIB>/QDDSSRC) RCDLEN(112) CCSID(5035) IGCDTA(*YES) TEXT('DDS source')"
```

こうすれば UTF-8 の全角がそのまま入り、SO/SI はコピー時に挿入される
（実機の画面で桁位置まで確認済み。`.aidev/works/20260827-dds-keyword-continuation/research.md` F4/F6）。

## 引用符の扱い（実際に踏んだ罠。**ssh 経路のみ**）

> hostserver 経路（6 節）には**この問題は無い**。CL 文字列を JS の文字列として
> そのまま渡すので、層が 1 つしかない。


`ssh 'system "CL ..."'` は**引用符が 3 層**（ローカル shell / ssh / CL）になる。
CL 文字列の中に `'` が要る場合、ローカルで単引用符を使うと壊れる。

- **ローカル側は二重引用符**にし、CL の内側は `\"` でエスケープする（本書の例の形）
- パス引数（`FROMSTMF` 等）は CL 側で単引用符が必須。
  `'/home/x/y'` を素直に書けるよう、外側を二重引用符にしておく
- 複雑になったら **SQL/CL をファイルに書いて転送**し、`RUNSQLSTM SRCSTMF('...')` で
  実行する（この経路も確認済み。ただし SELECT は通らない）

## 6. hostserver 経路（SR-OSAKA。Node から直接）

`ts5250` の hostserver ライブラリを **Node のスクリプトから呼ぶ**。ssh を経由しないので
速く、コマンド・IFS・SQL・スプールが**同じスクリプトの中で繋がる**。

### 6.0 秘密の渡し方

**`/workspaces/ts5250/.env` は読まない・値を出さない**（あちらの AGENTS.md の規約）。
`--env-file` で渡すだけ。識別子は `.env.verify` にあり、**こちらは読んでよい**
（`AS400_SYSTEM` / `AS400_LIB` / `AS400_IFS_DIR` / `AS400_PRTDEV`）。

```sh
cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify <スクリプト>
```

### 6.1 接続の型（これを写して使う）

```js
import { readFileSync } from "node:fs";
import { join } from "node:path";
const TS5250 = "/workspaces/ts5250";
const { CommandConnection, IfsConnection, DbConnection, query, NetPrintConnection } =
  await import(join(TS5250, "packages/hostserver/dist/index.js"));
const { SecretCrypto } = await import(join(TS5250, "packages/server/dist/secret-crypto.js"));
const profiles = JSON.parse(readFileSync(join(TS5250, "profiles.local.json"), "utf8"));
const sys = profiles.systems.find(s => s.id === process.env.AS400_SYSTEM || s.name === process.env.AS400_SYSTEM);
const creds = {
  host: sys.host, user: sys.signon.user,
  password: SecretCrypto.fromEnv()?.decrypt(sys.signon.passwordEnc)
};
const LIB = process.env.AS400_LIB, IFS = process.env.AS400_IFS_DIR;
```

| 接続 | 使いどころ |
|---|---|
| `CommandConnection` | CL コマンド（`.run()` が `{ success }` を返す） |
| `IfsConnection` | IFS への読み書き（`writeFile` / `deleteFile`） |
| `DbConnection` ＋ `query(db, sql)` | SQL。スプールの所在を引くのに使う |
| `NetPrintConnection` | **スプールの本文を読む**（`readSpooledPages`） |

### 6.2 最小のレシピ（送る → 型付け → コンパイル）

```js
const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try { await ifs.writeFile(`${IFS}/X.rpg`, new TextEncoder().encode(source), { create: true, truncate: true }); }
finally { ifs.close(); }

const cmd = await CommandConnection.connect({ ...creds, resolvePort: true });
try {
  await cmd.run(`CRTSRCPF FILE(${LIB}/QTMPSRC) RCDLEN(112)`);
  await cmd.run(`CPYFRMSTMF FROMSTMF('${IFS}/X.rpg') TOMBR('/QSYS.LIB/${LIB}.LIB/QTMPSRC.FILE/X.MBR') MBROPT(*REPLACE) STMFCCSID(1208)`);
  await cmd.run(`CHGPFM FILE(${LIB}/QTMPSRC) MBR(X) SRCTYPE(RPG)`);
  const r = await cmd.run(`CRTRPGPGM PGM(${LIB}/X) SRCFILE(${LIB}/QTMPSRC) SRCMBR(X) REPLACE(*YES)`);
} finally { cmd.close(); }
```

DBCS を含むなら `CRTSRCPF` に `CCSID(5035) IGCDTA(*YES)` を付ける（5 節の注記と同じ理由）。

### 6.3 ライブラリー・リストは持ち越せない

**`CommandConnection` はコマンドごとに別ジョブで動く。`ADDLIBLE` は次のコマンドに効かない。**

外部記述ファイルはコンパイル時に `*LIBL` で解決されるので、これを知らないと

```
CPF5715  File CUSTMAS in library *LIBL not found
```

を踏む。**そして「F 仕様の書き方が違う」と誤診する**——`20260828-rpg3-fspec-reclen` が
実際にそう結論して止まり、`20260828-rpg3-numeric-fields` で覆った（桁は最初から合っていた）。

回避は 2 つ:

- `*LIBL` に載るライブラリー（`QGPL` など）にファイルを置く
- `SBMJOB CMD(...) INLLIBL(...)` で 1 つのジョブにまとめて流す

### 6.4 コンパイル・リストを読む

**`CRTRPGPGM` などが返すメッセージに欄ごとの理由は入らない。** 返るのは
`QRG0008『Compile stopped. Severity level NN errors found』`まで。
**どの桁が悪いのかはコンパイル・リスト（スプール）にしかない。**

```js
const q = await query(db, `SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME
  FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
  WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME = '${name}'
  ORDER BY CREATE_TIMESTAMP DESC FETCH FIRST 1 ROWS ONLY`);
const sp = q.rows[0];
const [jobNumber, jobUser, jobName] = String(sp.JOB_NAME).split("/");
const pages = await printer.readSpooledPages({
  fileName: sp.SPOOLED_FILE_NAME, fileNumber: sp.FILE_NUMBER, jobName, jobUser, jobNumber
});
const text = pages.flatMap(p => (p.lines ?? p.rows ?? [])
  .map(l => (typeof l === "string" ? l : l.text ?? ""))).join("\n");
```

**踏みやすい 3 つ:**

- **スプール名は `QRPGLST` ではなく「対象の名前」**（`CRTRPGPGM` ならプログラム名、
  `CRTDSPF` ならメンバー名。4.5 節も参照）。取り違えると **0 件しか返らず、
  「メッセージが無い ＝ 正しい」と誤読する**。2026-08-29 に実際に踏み、
  **でたらめな語まで「有効」に見えた**。
- **件数が多いときは MCP のスプール取得を使わない。** 1 件で 18k トークンほど返る。
  上のように**スクリプト内で読んで必要な行だけ出す**（50 件流しても会話は数十行）。
- **`GENLVL` を上げたら「作成できたか」で判定しない。** `GENLVL(50)` では重大度 30 の
  誤りがあっても**プログラムは作成される**。存在しない語まで「通った」ことになる。
  **判定はメッセージ番号で行う。**

### 6.5 対照を置く。片付けは数えて確かめる

**対照（正しいと分かっている形・明らかに誤っている形）を必ず一緒に流す。**
先頭と末尾の両方に置くと、**途中で診断が止まっていないこと**も分かる。

> **対照が無ければ誤った結論を記録していた。** 6.4 のスプール名の取り違えは、
> 対照の `ZZZZZZ`（存在しない語）が「有効」と出たことで気付いた。
> 候補だけを流していたら、**30 語すべてを「有効」として定義に書き込んでいた。**

**片付けは「消すコマンドを呼んだ」ではなく「残っていないこと」を数えて確かめる。**

```js
const left = await query(db, `SELECT COUNT(*) AS N FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
  WHERE USER_NAME = CURRENT_USER AND SPOOLED_FILE_NAME IN (...)`);
const objs = await query(db, `SELECT OBJNAME FROM TABLE(QSYS2.OBJECT_STATISTICS('${LIB}','*ALL'))
  WHERE OBJCREATED > CURRENT TIMESTAMP - 6 HOURS`);
```

> 2026-08-29、`DLTSPLF` の `JOB()` に `番号/ユーザー/名前#ファイル番号` と書いており
> **書式が誤っていた**。`.catch(() => {})` で握り潰していたため気付かず、
> **71 件が残っていた**。数えて初めて分かった。

**スプールを消すときの書式**: `DLTSPLF FILE(<名前>) JOB(<番号/ユーザー/名前>) SPLNBR(<番号>)`。

## 7. RPGUnit（単体テスト）

**SR-OSAKA に導入済み**（`RPGUNIT` ライブラリー・iRPGUnit **v4.0.3.r**）。
pub400 には入れられない（`RSTLIB`/`RSTOBJ`/`CRTLIB` が `CPF9802`）。

**中身はここには書かない**（同じことを 2 か所に置かないため）:

| 知りたいこと | 見る先 |
|---|---|
| **導入・入れ直し・撤去**（版の選定・`DSPSAVF` での判定・`CLRLIB`→`RSTLIB`） | `docs/workflow/rpgunit-install.md` |
| **テストの書き方・実行・結果取得**（公開 API・`RUCALLTST` のパラメータ・XML/スプール） | skill **`rpgunit-test`** |

本書（転送・コンパイル層）から見て効くのは次の 2 点だけ。

- **`ADDLIBLE` は次のコマンドに効かない**（6.3）ので、RPGUnit の実行は
  **CL 1 本にまとめて `SBMJOB … INLLIBL(RPGUNIT …) INQMSGRPY(*DFT)`** で回す。
  `INQMSGRPY(*DFT)` が無いと、監視していない例外が照会になって**ジョブが `MSGW` で残る**。
- **`RUCRTRPG` は既定の 20 秒では終わらない。** `CommandConnection.connect({ timeoutMs })`
  を伸ばすか `SBMJOB` で切り離す。

**結果のスプール名は `RPGUNIT`**（`QSYSPRT` ではない）。`QSYSPRT` で探すと 0 件になり
「メッセージが無い＝成功」と誤読する——4.5 節の `QRPGLST` と同じ罠。
`RUCRTRPG` のコンパイル・リストは別で、そちらは**プログラム名**のスプールになる。


## 未確認事項

**現在なし。** かつてここにあった 3 件（RPGUnit の導入と実行 / 固定長での
コンパイル / `RUCALLTST` の結果出力の形式）はいずれも実機で確認して解消し、
`docs/workflow/rpgunit-install.md` と skill `rpgunit-test` に移した。

## 参照

- 設計書: `docs/workflow/ibmi-dev-workflow.md`（4.1 自律ループ / 6 章 安全規則）
- 調査: `.aidev/works/20260719-ibmi-dev-workflow/research.md`（F1・F8）
