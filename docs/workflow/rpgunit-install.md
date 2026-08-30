# RPGUnit（iRPGUnit）導入手順

IBM i の RPG 単体テスト・フレームワーク **iRPGUnit** を導入する手順。
**2026-08-29 に SR-OSAKA（IBM i 7.3）で実施した記録**であり、各段は実機で確かめてある。

テストの書き方と実行は skill **`rpgunit-test`**、転送・コンパイルの一般手順は
skill **`ibmi-remote`** を参照。

---

## 0. 先に決めること

### 導入先

| 機械 | 可否 | 根拠 |
|---|---|---|
| **SR-OSAKA** | **可** | `*ALLOBJ` ＋ `*SAVSYS` があり `RSTLIB` が通る |
| pub400 | **不可** | `RSTLIB` / `RSTOBJ` / `CRTLIB` がすべて `CPF9802`。一般アカウントに特殊権限が 1 つも無い |

pub400 で「ソースからビルドする」道は道具（`CRTBNDRPG` / `CRTSRVPGM` / `CRTCMD` /
`CRTMSGF`）が揃っているので不可能ではないが、RPGUnit のビルドがライブラリー名
`RPGUNIT` を前提にしており手直しが要る。

### バージョン — **最新を入れてはいけない**

| 版 | `RSTLIB` | 7.3 で使えるか |
|---|---|---|
| v6.0.2.r（最新） | 通る | **× ビルドできない** |
| **v4.0.3.r** | 通る | **○** |

v6 の `RUCRTRPG` は `CRTRPGMOD … TGTCCSID(…)` を発行するが、**`TGTCCSID` は
IBM i 7.3 の `CRTRPGMOD` に存在しない**（後のリリースで追加）。

```
CPD0043  Keyword TGTCCSID not valid for this command.
CPF0001  Error found on CRTRPGMOD command.
CPF9897  Unable to create test <名前>.
```

> **保存形式の互換（`TGTRLS`）と、コマンドが使うキーワードの互換は別物。**
> 「復元できた＝使える」と読まないこと。

### ライブラリー名は既定の `RPGUNIT` にする

既存の作業ライブラリー（例 `ASAOLIB`）に**混ぜない**。分けておけば
`DLTLIB` / `CLRLIB` で丸ごと戻せる。既定名なら `UPDLIB` も再コンパイルも要らない
（別名にすると `UPDLIB LIB(<名前>)` で参照を貼り直す必要がある）。

---

## 1. 配布物を入手する

配布元は **GitHub `tools-400/irpgunit`**（SourceForge は 2024-11-03 に移行）。
ただし **v4.0.3.r は SAVF 単体の配布が無い**ので、SourceForge の Update Site zip から取り出す。

```sh
curl -sL -o v4site.zip \
  "https://sourceforge.net/projects/irpgunit/files/iRPGUnit%20for%20RDi%209.5.1.3%2B%20%28v4.0.3.r%20Update%20Site%29.zip/download"
unzip -j v4site.zip 'Server/RPGUNIT.SAVF' -d v4
sha256sum v4/RPGUNIT.SAVF
#   3309f68e8c8b73529bc2a74dc905d52db6e66ac34a0fcc76506afbe5ecc54ea0  （4,994,880 バイト）
```

同じ zip の `Server/upload_savf.cmd` がベンダー公式の導入手順を持つ（下の 4 節の出典）。

新しい版を使う場合（7.4 以降の機械）は GitHub のリリースから SAVF を直接取れる。

```sh
gh release download v6.0.2.r --repo tools-400/irpgunit --pattern 'RPGUNIT.SAVF'
```

---

## 2. SAVF を実機に載せる

**IFS へ書いてから `CPYFRMSTMF` で SAVF オブジェクトに移す**。FTP は使わない。

```js
// hostserver 経由（skill `ibmi-remote` 6 節の接続の型を使う）
const ifs = await IfsConnection.connect({ ...creds, resolvePort: true });
try {
  await ifs.writeFile(`${IFS}/RPGUNIT.SAVF`,
    new Uint8Array(readFileSync("v4/RPGUNIT.SAVF")), { create: true, truncate: true });
} finally { ifs.close(); }
```

```
CRTSAVF    FILE(<lib>/RPGUNIT) TEXT('iRPGUnit v4.0.3.r savf')
CPYFRMSTMF FROMSTMF('<IFS>/RPGUNIT.SAVF')
             TOMBR('/QSYS.LIB/<lib>.LIB/RPGUNIT.FILE') MBROPT(*REPLACE) CVTDTA(*NONE)
```

**`CVTDTA(*NONE)` を忘れない**（バイナリなので変換させない）。

> SAVF の中身を base64 で会話に載せない。5MB がそのまま文脈を潰す。

---

## 3. 入れる前に `DSPSAVF` で確かめる

**ここが版の判定点。** バイト列を眺めて判断してはいけない。

```
DSPSAVF FILE(<lib>/RPGUNIT) OUTPUT(*PRINT)
```

出力（スプール `QPSRODSP`）の `Release level` が**復元可否を決める値**。

```
 Save file  . . . :   RPGUNIT
   Library  . . . :     ASAOLIB
   Records  . . . :     9460
 Save operation:
   Save command . :   SAVLIB
   Release level  :   V7R1M0        ← これが TGTRLS。7.1 以降に復元できる
 Data saved:
   Library  . . . :   RPGUNIT
   System name  . :   GFD400
```

**SAVF のバイト列に見える `VxRyMz` は別物**（オブジェクトの作成リリース）。実測で食い違う。

| 版 | ファイル内の文字列 | `DSPSAVF` の `Release level` |
|---|---|---|
| v4.0.3.r | `V7R3M0` | **V7R1M0** |
| v6.0.2.r | `V7R5M0` | **V7R3M0** |

---

## 4. 復元する

```
RSTLIB SAVLIB(RPGUNIT) DEV(*SAVF) SAVF(<lib>/RPGUNIT)
```

→ `CPC3703 32 objects restored from RPGUNIT to RPGUNIT.`

**既定のライブラリー名なら、これで終わり。** 原典にこう書かれており、実際そのとおりだった。

> You do not necessarily need to compile the library unless you want to run the
> RPGUnit self-test **or in case you did not use the default library name _RPGUNIT_**.

v4 同梱の `upload_savf.cmd` は続けて `A_INSTALL` の作成・実行を指示するが、
既定名では不要。**v6 には `RPGUNIT1` が無い**ので、v4 の手順をそのまま当てると
`CPF4102 File RPGUNIT1 … member A_INSTALL not found` になる。

---

## 5. 確認する

```sql
SELECT OBJNAME, OBJTYPE, OBJTEXT
  FROM TABLE(QSYS2.OBJECT_STATISTICS('RPGUNIT','*CMD *SRVPGM'))
 ORDER BY OBJTYPE, OBJNAME
```

揃っているべきもの:

| 種類 | 名前 |
|---|---|
| `*CMD` | `RUCALLTST` / `RUCRTRPG` / `RUCRTTST` / `RUCRTCBL` / `CMPMOD` / `UPDLIB` |
| `*SRVPGM` | `RUTESTCASE`（v6 は `RUMEMMGR` も） |
| `*BNDDIR` | `IRPGUNIT`（v6） |
| `*JOBD` | `RPGUNIT` |

仕上げに 1 本テストを通す（skill `rpgunit-test`）。

---

## 6. 入れ直し・撤去

### 入れ直しは `CLRLIB` → `RSTLIB`

**`DLTLIB` は `CPF2113 Cannot allocate library` で通らないことがある。**
ロックの主は `QZRCSRVS` の**事前開始ジョブ**で、過去の `ADDLIBLE RPGUNIT` の名残の
`*SHRRD` を保持している。事前開始ジョブは再利用されるので放っておいても消えない。

```
CLRLIB LIB(RPGUNIT)
RSTLIB SAVLIB(RPGUNIT) DEV(*SAVF) SAVF(<lib>/RPGUNIT)
```

`ENDJOB` すれば `DLTLIB` も通るが、**他人の接続を巻き込む**ので `CLRLIB` で足りる。

> **`DLTLIB` の失敗を確認せずに `RSTLIB` を続けない。** 版が混在する。
> 実際に踏んだ: v6 の上に v4 を復元したところ 21 オブジェクトだけ置き換わり、
> ソース物理ファイル 11 個は `CPF3283 Saved file or member level ID not same` で
> 拒否され、**v4 のプログラム＋ v6 のソース**という状態になった。

### 撤去

```
DLTLIB LIB(RPGUNIT)          （ロックされていれば CLRLIB してから）
DLTF   FILE(<lib>/RPGUNIT)   （SAVF）
```

---

## 7. 既知の制約（日本語環境）

**RPGUnit の出力はラテン系のコードページで作られる。** savf の `System name` が
`GFD400` であるとおり他社機でビルドされており、プログラム内のリテラルがそのまま焼かれている。

| 出口 | 症状 |
|---|---|
| **スプール** | 日本語 CCSID の表示装置では **ASCII まで化ける**（小文字がカタカナになる） |
| **XML** | ファイルの CCSID が **819（ISO 8859-1）**。宣言は `encoding="UTF-8"` だが実体は Latin-1。**日本語のメッセージは空になる** |

`CHGJOB CCSID(37)` では直らない（表示は装置の文字セットで決まる）。
**`CHRID` では救えない**（実機で確認済み）。`CHGSPLFA` に `CHRID` パラメータは無く
（`CPD0043`）、作成時に `OVRPRTF FILE(QSYSPRT) CHRID(697 37)` を掛けても表示は変わらない。
**上書き自体は届いている**——同じ上書きに `SPLFNAME(CHRQ)` を足すとスプール名が変わるので、
RUCALLTST が `QSYSPRT` を開いていること、上書きが効いていることの両方が確かめられる。
それでも化けたままなので、**CHRID 翻訳では直らない**と結論する。

**回避**: CI のレポートに出す文字は ASCII で書く。人が読むならスプールを当てにせず、
プログラムからラテン系でデコードして読む（skill `rpgunit-test`）。

---

## 参照

- 実行とテストの書き方: skill **`rpgunit-test`**
- 転送・コンパイル・スプール読み: skill **`ibmi-remote`**
- 導入と検証の記録: `.aidev/works/20260829-rpgunit-sr-osaka/`
- 原典: <https://irpgunit.sourceforge.io/help/html/installation/installation.html>
