# 調査: RPGUnit の導入経路とバージョン互換

## 調査の問い

- **Q1**: 導入は「SAVF を配置して `RSTLIB` するだけ」か。後処理は要るか。
- **Q2**: どのバージョンが IBM i 7.3（SR-OSAKA）に入るか。
- **Q3**: ライブラリー名を既定の `RPGUNIT` 以外にできるか。
- **Q4**: 固定長から `**free` の include を `/COPY` できるか。

## 判明した事実

### F1: 配布元は SourceForge ではなく GitHub（2024-11-03 に移行）

`sourceforge.net/projects/irpgunit` に「As of 2024-11-03, this project can be found here」と
あり、**`tools-400/irpgunit`（GitHub）**が現在の配布元。リリース資産に
**`RPGUNIT.SAVF` が単体で付く**（Update Site の zip とは別）。

| リリース | 日付 | SAVF |
|---|---|---|
| v6.0.2.r | 2026-08-25 | 7,816,512 B |
| v6.0.1.r | 2026-07-26 | 7,815,984 B |
| v6.0.0.r | 2026-01-25 | 7,814,400 B |
| v5.1.0.r | 2025-07-12 | 6,093,648 B |

旧 SourceForge の **v4.0.3.r（2023-03-26）は SAVF 単体が無く**、Update Site zip の
`Server/RPGUNIT.SAVF`（4,994,880 B、`sha256:3309f68e…54ea0`）に同梱されている。
同じ zip の `Server/upload_savf.cmd` がベンダー公式の導入手順を持つ。

### F2: 「`RSTLIB` するだけ」ではない（Q1）— ただし版で違う

v4.0.3.r の `upload_savf.cmd` が指示する手順:

```
1. RSTLIB SAVLIB(RPGUNIT) DEV(*SAVF) SAVF(<lib>/RPGUNIT)
2. ADDLIBLE RPGUNIT
3. CRTBNDCL PGM(RPGUNIT/A_INSTALL) SRCFILE(RPGUNIT/RPGUNIT1) SRCMBR(*PGM)
4. CALL   PGM(RPGUNIT/A_INSTALL) PARM('RPGUNIT')
```

一方 v6 の原典（`irpgunit.sourceforge.io/help/html/installation/installation.html`）は

> You do not necessarily need to compile the library unless you want to run the RPGUnit
> self-test **or in case you did not use the default library name _RPGUNIT_**.

**既定名なら後処理は不要**。v6 には `RPGUNIT1` が存在せず（ソース物理ファイルは
`QBND`/`QBUILD`/`QCMD`/`QINCLUDE`/…）、v4 の手順をそのまま当てると
`CPF4102 File RPGUNIT1 … member A_INSTALL not found` になる（実際に踏んだ）。

### F3: **オブジェクトの作成リリースと `TGTRLS` は別物**（Q2 の前提）

SAVF のバイト列を cp037 で読むと `VxRyMz` の文字列が拾えるが、**それはオブジェクトの
作成リリース**であって復元可否を決める `TGTRLS` ではない。**`DSPSAVF` が正しい判定手段**。

| 版 | ファイル内の文字列 | `DSPSAVF` の `Release level` |
|---|---|---|
| v6.0.2.r | `V7R5M0` × 29 | **V7R3M0** |
| v4.0.3.r | `V7R3M0` × 26 | **V7R1M0** |

**バイト列だけで「v5 以降は 7.3 に入らない」と判断したのは誤りだった。**
実際は v6.0.2.r も `RSTLIB` は通り、34 オブジェクトが復元できた。

### F4: しかし v6 は 7.3 で**ビルドできない**（Q2 の答え）

復元できることと使えることは別だった。v6 の `RUCRTRPG` を 7.3 で走らせると:

```
CPD0043  Keyword TGTCCSID not valid for this command.   ← CRTRPGMOD に TGTCCSID が無い
CPF0001  Error found on CRTRPGMOD command.
CPF9897  Unable to create test FIXTST2.
CPF9999  Function check … unmonitored
```

`TGTCCSID` は IBM i 7.3 の `CRTRPGMOD` に**存在しない**（後のリリースで追加）。
**`TGTRLS(V7R3M0)` で保存されていても、コマンドが発行するキーワードまでは下位互換にならない。**
→ **7.3 で使えるのは v4.0.3.r。**

### F5: ライブラリー名は変えられるが、変えなければ何もしなくてよい（Q3）

原典に「Starting with version 4 you can use the _UPDLIB_ command to update the references
between the RPGUnit objects after renaming the library」とあり、`UPDLIB` コマンドが
実際に配布物に含まれる（`RPGUNIT/UPDLIB *CMD`）。既定名のままなら不要。

### F6: **固定長から `**free` の include を `/COPY` できる**（Q4 の答え）

`RPGUNIT/QINCLUDE,TESTCASE` は 775 行で 1 行目が `**free`。テンプレート
（`QTEMPLATE,RPG`）も `**free`。それでも**固定長の主ソースから `/COPY` してコンパイルが通る**。

```
対照 **free : RNS9305 Module FREETST placed in library ASAOLIB. 00 highest severity.
本命 固定長 : RNS9305 Module FIXTST  placed in library ASAOLIB. 00 highest severity.
```

**対照を置いたことが効いた。** 最初の試行は両方落ちており（`CPF4102 … QINCLUDE …
member TEMPLATES not found`）、対照も落ちたことで「固定長が原因ではない」と分かった。
真因は `TESTCASE` が**入れ子で非修飾の `/include qinclude,TEMPLATES`** を持つことで、
`RPGUNIT` が `*LIBL` に要る。外側の `/COPY` を修飾しても内側には効かない。

### F7: 公開 API（`QINCLUDE,TESTCASE` の prototypes）

`assert(condition : msgIfFalse)` / `iEqual(expected : actual [: fieldName])` /
`nEqual(ind : ind)` / `aEqual(char : char)` / `fail(msg)` /
`assertJobLogContains(msgId)`。いずれも `extproc` ＋ `opdesc`。

## 実現性 / リスク

- **`ADDLIBLE` は次のコマンドに効かない**（`CommandConnection` はコマンドごとに別ジョブ）。
  RPGUnit は非修飾の入れ子 include を持つので、**コンパイルは 1 ジョブにまとめる**必要がある
  （CL にまとめる／`SBMJOB INLLIBL(...)`）。
- **CL のコマンド解決はコンパイル時**。CL 中の `RUCRTRPG` は `RPGUNIT/RUCRTRPG` と
  修飾しないと `CPD0030 Command … not found` でコンパイルが落ちる（実行時の `ADDLIBLE` では遅い）。
- **非対話の接続で応答待ちに落ちる**。監視していない関数チェックは照会メッセージになり、
  ジョブが `MSGW` のまま残る。`SBMJOB … INQMSGRPY(*DFT)` で回避する。
- **`ADDLIBLE` の名残でライブラリーがロックされる**。`QZRCSRVS` は事前開始ジョブで
  再利用されるため、`*SHRRD` が残って `DLTLIB` が `CPF2113` になる。
  **`CLRLIB` は通る**ので、入れ直しはそれで足りる（他人のジョブを落とさずに済む）。

## 実装アンカー

- **A1**: 転送（`IfsConnection.writeFile` → `CPYFRMSTMF … CVTDTA(*NONE)`）
  — `.claude/skills/ibmi-remote/SKILL.md`「6.2」。savf も同じ形で載る。
- **A2**: 長時間コマンド（`CommandConnection.connect({ timeoutMs })`。既定 20 秒では
  `RUCRTRPG` が完了しない）— `packages/hostserver/dist/transport/host-connection.js:23`。
- **A3**: スプール読み（`readSpooledPages({ fileName, fileNumber, jobName, jobUser, jobNumber })`。
  **`name`/`number` ではない**）— `packages/hostserver/dist/spool/netprint-connection.js:101`。

## spec への申し送り

- **入れるのは v4.0.3.r**（F4）。既定ライブラリー名 `RPGUNIT` のままにするので `UPDLIB` は不要。
- v4 の手順は `A_INSTALL` を含むが、**まず `RSTLIB` だけで動くかを確かめる**
  （v6 の原典が「既定名なら不要」と言っており、v4 でも同じ可能性がある）。
- **検証は対照つきで行う**（F6 で対照が誤読を止めた実績）。
