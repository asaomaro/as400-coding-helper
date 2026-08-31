---
name: rpgunit-test
description: RPGUnit（iRPGUnit）で IBM i の単体テストを書き、ビルドし、実行し、結果を取得する。「RPGUnit のテストを書いて」「テストを走らせて」「RUCALLTST の結果を見て」「単体テストを追加して」「テスト結果を取って」などのとき、または CI に載せる XML が要るときに使用する。導入そのものは docs/workflow/rpgunit-install.md。
allowed-tools: [Bash, Read, Write]
---

# RPGUnit でテストを書く・走らせる・結果を取る

**SR-OSAKA に導入済み**（`RPGUNIT` ライブラリー・iRPGUnit **v6.0.2.r**）。
pub400 には入っていない（入れられない）。

> **v5 以降は `RUCRTRPG … TGTCCSID(0)` が要る**（7.3 の `CRTRPGMOD` に `TGTCCSID` が
> 無いため）。`tools/run-rpgunit.mjs` は常に付けるので、道具を使う限り意識しなくてよい。

- **導入・入れ直し・撤去** → `docs/workflow/rpgunit-install.md`
- **転送・コンパイル・スプール読みの一般手順** → skill `ibmi-remote`（特に 6 節の接続の型）

以下はすべて実機で確かめたもの。踏んだ罠はその旨を書いてある。

---

## 0. AI にテストを書かせるときの規律

**この節が手順の入口。** 設計書 4.2「AI にテストを書かせる場合の方針」を実行手順に
落としたもの。書く前にここを読む。

> **期待値の出所（オラクル）を誤ると害になる。** 実装を読んで「今こう動いている」を
> assert するテストは、バグごと固定して**検出力ゼロで全部グリーン**になる。
> グリーンが安心材料として働くぶん、**テストが無い状態より悪くなりうる**。

### 0.1 書く前に決める — オラクルはあるか

| | 新規コード | 既存コード |
|---|---|---|
| オラクル | **設計書・業務仕様** | 現在の挙動 |
| 性格 | **検証**（正しいか） | **特性化**（今どうか） |
| 主張できること | 仕様どおり | **現状を固定しただけ** |

見分ける質問は 1 つ。

> **その期待値は、実装を消しても書けるか。**

書けるなら検証テスト。書けないなら**特性化テスト**であり、そう名乗らせる。
同じ「実装を読んで期待値を書く」行為が、**名乗るかどうかで有害にも有用にもなる**。

**オラクルになるもの**: 設計書・業務仕様の条項 / IBM 原典 / 法令・業界標準（税率・丸め規則）
**ならないもの**: 実装のコード / 「今こう返ってくる」という実行結果 / 別の AI の出力

### 0.2 書く — 期待値の出所を成果物に残す

**コードを読んでも「どこから来た値か」は分からない。** ヘッダーに書かせる。

検証テスト:

```
      * ==================================================================
      *  検証テスト（VERIFICATION）
      *  オラクル: 設計書 3.2「消費税は円未満を切り捨てる」
      * ==================================================================
```

特性化テスト:

```
      * ==================================================================
      *  特性化テスト（CHARACTERIZATION）— 検証テストではない
      *  期待値の出所: 2026-08-31 時点の CALCSRV の実際の戻り値
      *  仕様書の裏付け: 無し
      *  → 落ちたときは「コードが悪い」と決めつけない。仕様を確認する
      * ==================================================================
```

**この印は機械で検査できる。** `VERIFICATION` も `CHARACTERIZATION` も無いテストは
出所が不明なので差し戻す。特性化テストを「網羅した」という報告に混ぜない。

**アサーションは V2（`assertEqual`）を使う**（2 節）。旧 `iEqual` は型で丸めるため
**検出力が落ちる**——実例: `iEqual(105 : addTax(100 : 0.055))` は通るが、実際の戻りは `105.50`。

### 0.3 検品する — 3 つとも回す

| 検品 | 何を確かめるか | コマンド |
|---|---|---|
| **コンパイル** | 生成コードが妥当か | `run-rpgunit.mjs`（`RUCRTRPG` が即座に判定） |
| **独立性** | テストが互いに依存していないか | `run-rpgunit.mjs … --check-independence` |
| **検出力** | 同義反復でないか | ミューテーション（下記） |

**ミューテーションの回し方**:

```
1. 実装に変異を 1 つ入れる（下表）
2. node tools/run-rpgunit.mjs <テスト> --bnd <対象>
3. **終了コード 1 を期待する。0 なら穴**
4. 変異を戻し、緑に復帰することを確認する    ← 省かない
```

落ちなかったら**削除・書き直し**（設計書）。実装の写しなら期待値をオラクルから取り直し、
検証範囲に無いなら足し、何も検証していないなら消す。**緑のまま放置しない。**

RPG で効く変異:

| 種類 | 例 |
|---|---|
| 演算子 | `+` ↔ `-` / `*` ↔ `/` |
| 比較 | `>` ↔ `>=` / `=` ↔ `<>` |
| 境界 | リテラルを ±1 |
| **桁・小数部** | **`%DEC(… : 11 : 2)` の `2` を `0` に** ← RPG 特有。型丸めの見落としを暴く |
| 標識 | `*ON` ↔ `*OFF` |

**大きい変異は雑なテストでも捕まる。検出力の弱さを暴くのは小さい変異。**

### 0.4 「網羅」の数え方

> コード行に対する網羅ではなく、**設計書の条項に対する網羅**とする。
> カバレッジは参考値に留める。**行カバレッジは網羅の証明にならない。**

特性化テストは**網羅に数えない**（オラクルが無いので条項に対応づかない）。

### 0.5 既存コードに単体テストが書けないとき

設計書の「壁 1」。既存の固定長 RPG の多くは画面付きで**呼び出し口が無い**。
段 1 に落とすには切り出しが要るが、**その切り出しこそテストで守りたい＝鶏と卵**。

> 順序は「**E2E で外側を固める → その保護下で切り出す → 段 1 に RPGUnit**」。
> テスト 3 層は**上から埋める**（ユニットが先ではない）。

**RPG III には単体テストを書けない**（サブプロシージャーが無い）。E2E で担当する。

## 1. テストの形

**NOMAIN のサービスプログラム**を書く。`export` した手続きのうち
**名前が `test` で始まるもの**がテストケースになる。

| 手続き | 呼ばれるタイミング |
|---|---|
| `setUpSuite` / `tearDownSuite` | スイート全体の前後に 1 回 |
| `setUp` / `tearDown` | **各テストの前後** |
| `test*` | テストケース本体 |

**固定長で書ける**（対照つきで確認済み）。`**free` でも書ける。

```
     H NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)
      /COPY RPGUNIT/QINCLUDE,TESTCASE
     PTESTPASS         B                   EXPORT
     DTESTPASS         PI
     C                   CALLP     iEqual(2:2)
     PTESTPASS         E
```

**`OPTION(*SRCSTMT)` を付ける。** 失敗報告のソース位置（`(PGM->MODULE:900)`）が
これで元のソース行に戻せる。

### 何を「単位」にするか

`RUCRTRPG` は `BNDSRVPGM` / `MODULE` / `BNDDIR` を持つ（既定はいずれも `*NONE`）。
想定は「**テスト対象をテスト・サービスプログラムにバインドし、その手続きを直接呼ぶ**」。
`*PGM` を `CALL` する形も書けるが粒度が粗い。

**画面プログラム（DSPF を開くもの）は自動テストに乗らない**——バッチジョブに表示装置が無いため。
業務ロジックを手続きに切り出し、画面プログラムを薄い殻にするのがテストできる形。

**バインドの実例が `tools/example/` にある**（プロトタイプ ＋ 対象 ＋ テストの 3 本）。
実機で通し、**対象を壊すとテストが落ちること**まで確かめてある。

```
node tools/run-rpgunit.mjs tools/example/CALCTST.rpgle --bnd CALCSRV
```

- 対象のビルドは**利用者側の仕事**（道具は束ねるだけ）。`EXPORT(*ALL)` で足りる。
- `/COPY` を修飾しないなら、対象のビルドも `SBMJOB … INLLIBL(<lib> …)` で組む
  （ソース PF が `*LIBL` に無いと `CPF4102`）。
- **署名が変わらなければ、対象を差し替えるだけでテストは新しい実装を見る。**

---

## 2. 判定に使う手続き（公開 API 全 18 件）

`/COPY RPGUNIT/QINCLUDE,TESTCASE` で入る。
**戻り値を比べるだけの道具ではない。** IBM i の副作用を検証するために作られている。

> **新規は V2（`assertEqual`）を使う。** 旧 API（`iEqual` / `aEqual` / `nEqual`）は
> v4 にしか無かった名残で、**型ごとに手続きが分かれているぶん誤りを隠す**。
> 実例: `iEqual(105 : addTax(100 : 0.055))` は `zoned(31:0)` に丸められて**通ってしまう**が、
> 実際の戻りは `105.50`。`assertEqual` なら `Expected '105', but was '105.5'.` で落ちる。
> **偽の緑を掴んでいた**（実機で確認）。

| 分類 | 手続き | 用途 |
|---|---|---|
| **値の比較（V2）** | **`assertEqual(期待 : 実際 [: メッセージ])`** | **型で自動振り分け。これを使う** |
| 値の比較（旧・v4 のみ） | `iEqual` / `aEqual` / `nEqual` | 数値 / 文字 / 標識。**新規では使わない** |
| 一般 | `assert(condition : msgIfFalse)` | 任意の条件 |
| | `fail(msg)` | 無条件に失敗。**「例外が飛ぶはず」の検証に使う** |
| **例外** | `getMonitoredMessage()` | 監視した例外の情報を取る。`fail()` と組で使う |
| **メッセージ** | `assertJobLogContains(msgId [: since])` | ジョブログにそのメッセージが出たか |
| | `assertMessageQueueContains(msgId [: since])` | メッセージキューに出たか |
| 下ごしらえ | `runCmd(cmd)` | CL コマンドを実行する（arrange / act） |
| | `clrpfm(file : lib)` | 物理ファイルをクリア（**フィクスチャの後始末**） |
| | `rclactgrp(...)` | 活動化グループの再利用（状態のリセット） |
| | `waitSeconds` / `getFullTimeStamp` / `getMemberType` / `setLowMessageKey` | 補助 |
| 画面 | `displayStatusMessage` / `restoreStatusMessage` / `clearStatusMessage` | 進捗表示 |

### 例外が飛ぶことの検証（実機で通した実物）

```
     H NOMAIN OPTION(*SRCSTMT:*NODEBUGIO)
      /COPY RPGUNIT/QINCLUDE,TESTCASE
     PTESTEXC          B                   EXPORT
     DTESTEXC          PI
     DMSGINFO          DS                  LIKEDS(MsgInfo_t)
     DA                S             10I 0
     DB                S             10I 0
     C                   MONITOR
     C                   EVAL      B = 0
     C                   EVAL      A = 1 / B
     C                   CALLP     fail('例外が飛ぶはずだった')
     C                   ON-ERROR
     C                   EVAL      MSGINFO = getMonitoredMessage()
     C                   CALLP     aEqual('MCH1211': MSGINFO.Id)
     C                   ENDMON
     PTESTEXC          E
```

**`getMonitoredMessage()` の戻りは DS なので、いったん `LIKEDS(MsgInfo_t)` の変数へ代入する**
（`getMonitoredMessage().Id` のようには書けない）。

### SQLRPGLE も固定長で書ける

`RUCRTRPG` は**メンバーのソースタイプで分岐する**（`RPGUNIT/QSRC,CRTRPG`）。
`getMemberType()` で読み、`MBR_RPGLE` か `MBR_SQLRPGLE` 以外は蹴る。
**`CHGPFM … SRCTYPE(SQLRPGLE)` を忘れると `RPGLE` として扱われて落ちる。**

```
     C/EXEC SQL
     C+ SELECT 42 INTO :N FROM SYSIBM.SYSDUMMY1
     C/END-EXEC
     C                   CALLP     iEqual(42:N)
```

SQL 版テンプレートが同梱されている（v4 は `QSRC,TEMPLSQL`）。想定の書き方は
「SQL を撃って `SQLSTATE` を assert する」で、`isSQLError()` / `setIgnSQLWarn()` が付属。

**テンプレートは `set option commit = *none;` で始まる。** コミットメント制御を使わないので
**ロールバックによるテスト間の分離は効かない**——後始末は `tearDown` 頼み。
独立性は `ORDER(*REVERSE)`（下記）で検品する。

---

## 3. ビルドと実行

```
RUCRTRPG   TSTPGM(<lib>/<名前>) SRCFILE(<lib>/<ソースPF>) SRCMBR(<メンバー>)
RUCALLTST  TSTPGM(<lib>/<名前>)
```

`RUCALLTST` の主なパラメータ（`RPGUNIT/QCMD,RUCALLTST` の定義から）:

| パラメータ | 値 | 既定 |
|---|---|---|
| `TSTPRC` | `*ALL` / 手続き名（最大 250） | `*ALL` |
| **`ORDER`** | `*API` / **`*REVERSE`** | `*API` |
| `DETAIL` | `*BASIC` / `*ALL` | `*BASIC` |
| `OUTPUT` | `*ALLWAYS` / `*ERROR` / `*NONE` | `*ALLWAYS` |
| `LIBL` | `*CURRENT` / `*JOBD` / ライブラリー名（最大 250） | `*CURRENT` |
| `RCLRSC` | `*NO` / `*ALWAYS` / `*ONCE` | `*NO` |
| `XMLSTMF` | IFS のパス（最大 1024） | `*NONE` |

**`ORDER(*REVERSE)` はテストの独立性の検品に使う。** 後始末を書き忘れたテストはここで落ちる。

他に `CMPMOD`（モジュール単体）・`RUCRTCBL`（COBOL）・`UPDLIB LIB(<名前>)`
（ライブラリー名を変えた後の参照貼り直し）。

### **メンバー名はテストプログラム名と同じにする**

`SRCMBR` に別名を渡しても効かない。`getMemberType` が**プログラム名のメンバー**を
探しに行って落ちる（実測。2 回再現）。

```
RUCRTRPG TSTPGM(ASAOLIB/BLDD) SRCFILE(ASAOLIB/QUNITSRC) SRCMBR(FIXTST2)
→ CPF9815  Member BLDD file QUNITSRC in library ASAOLIB not found.   （To procedure: getMemberType）
```

`SRCFILE` は効く（既定の `QRPGLESRC` ではなく `QUNITSRC` を見に行っている）ので、
効かないのは `SRCMBR` だけ。**RUCRTRPG の仕様か `SBMJOB` 経由特有かは切り分けていない**が、
名前を揃えれば起きない。

### まず `tools/run-rpgunit.mjs` を見る

**転送・ビルド・実行・結果採取を 1 コマンドで通す道具がある。**
下の罠は全部その中に閉じ込めてあるので、**手で組む前にこちらを使う**。

```
cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify \
  <repo>/tools/run-rpgunit.mjs <ソース> --xml build/rpgunit.xml
```

終了コードは `0`=全合格 / `1`=テスト失敗 / `2`=道具の異常（ビルド失敗を含む）。
詳細は [`tools/README.md`](../../../tools/README.md)。

以下は**その道具が中で何をしているか**——手で組む必要が出たときのための記録。

### 走らせ方の型

**CL driver は必須ではない。** `SBMJOB` の `CMD()` に直接書ける（実測）。
`INLLIBL` がそのジョブの `*LIBL` を作るので `ADDLIBLE` も要らない。

```
SBMJOB CMD(RPGUNIT/RUCALLTST TSTPGM(<lib>/<名前>) OUTPUT(*NONE) +
             XMLSTMF('<IFS>/result.xml'))
         JOB(RUNTST) INLLIBL(RPGUNIT <lib> QGPL QTEMP) INQMSGRPY(*DFT)
```

ビルドも同じ形でよい。

```
SBMJOB CMD(RPGUNIT/RUCRTRPG TSTPGM(<lib>/<名前>) SRCFILE(<lib>/<src>) +
             SRCMBR(<名前>))
         JOB(BLD) INLLIBL(RPGUNIT <lib> QGPL QTEMP) INQMSGRPY(*DFT)
```

**ビルドと実行を 1 ジョブでまとめたいときだけ CL driver を使う**（2 本の `SBMJOB` は
互いを待たないので、実行が先に走りうる）。`ADDLIBLE` は次のコマンドに効かない
（`ibmi-remote` 6.3）ので、driver 側では `RPGUNIT/` で修飾する。

```
             PGM
             ADDLIBLE   LIB(RPGUNIT)
             MONMSG     MSGID(CPF2103)
             RPGUNIT/RUCRTRPG TSTPGM(<lib>/<名前>) SRCFILE(<lib>/<src>) +
                          SRCMBR(<メンバー>)
             MONMSG     MSGID(CPF0000)
             RPGUNIT/RUCALLTST TSTPGM(<lib>/<名前>) OUTPUT(*NONE) +
                          XMLSTMF('<IFS>/result.xml')
             MONMSG     MSGID(CPF0000)
             ENDPGM
```

```
SBMJOB CMD(CALL PGM(<lib>/<driver>)) JOB(RUNTST) +
         INLLIBL(RPGUNIT <lib> QGPL QTEMP) INQMSGRPY(*DFT)
```

完了はジョブの消滅で待つ。

```sql
SELECT JOB_NAME FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO=>'NONE'))
 WHERE UPPER(JOB_NAME) LIKE '%RUNTST%'
```

---

### 独立性を検品する（設計書 4.2 の「逆順実行」）

**順序依存は、正順だけ走らせている限り緑**なので人のレビューでは見つからない。
正順と逆順を両方走らせ、**合否が食い違えば失敗**にする。

```
node tools/run-rpgunit.mjs <ソース> --check-independence
```

```
▸ 独立性   正順 0 失敗 / 逆順 1 失敗  … **食い違いあり**

  正順と逆順で合否が違うテスト（順序に依存している）:
    ✗ TESTUSES  正順=合格 / 逆順=失敗
```

**比べるのは合否だけ**（実行時間・並び順・文言は毎回変わるので差にしない）。
`--order api|reverse` で片方だけ走らせることもできる。
活動化グループ由来の漏れには `--rclrsc always` を併せる。

**IBM i で漏れる経路**（どれも見えにくい）:

| 経路 | 何が残るか |
|---|---|
| DB の状態 | テンプレートが `set option commit = *none;` なので**ロールバックが効かない**。後始末は `tearDown` 頼み |
| 活動化グループ | サービスプログラムのグローバルが呼び出しをまたぐ |
| ジョブログ | `assertJobLogContains` が**前のテストの例外で通る**。枠組みは各テスト前に `setLowMessageKey` を自動で呼ぶが、`timeLimit` を広く取れば漏れる |

**逆順で足りないとき**（対称な依存・スイート全体が前回に依存）は、
`RUCALLTST … TSTPRC(<手続き名>)` で 1 件ずつ単独に走らせるか、同じスイートを 2 回続けて走らせる。

## 4. 結果を取る

出口は **2 つあり、独立して制御できる**。

| 出口 | 制御 | 既定 |
|---|---|---|
| スプール | `OUTPUT(*ALLWAYS` / `*ERROR` / `*NONE)` | `*ALLWAYS`（必ず出る） |
| XML（IFS） | `XMLSTMF('<パス>')` | `*NONE`（出ない） |

`OUTPUT(*NONE)` にすればスプールは 1 件も出ない（3 回呼んで確認済み）。

### XML（**CI はこちらを使う**）

**JUnit 形式そのもの**なので、GitHub Actions や Jenkins のレポーターがそのまま食える。

```xml
<testsuite errors="0" failures="2" name="ASAOLIB/MSGTST" tests="2" >
    <properties>
        <property name="user.librarylist" value="RPGUNIT    ASAOLIB    QGPL       QTEMP      "/>
        <property name="os.version" value="V7R3M0"/>
        <property name="irpgunit.version" value="4.0.3"/>
    </properties>
    <testcase name="TESTASCII" assertions="0" classname="MSGTST" time="0.001" >
        <failure message="ASCII failure text">
TESTASCII (MSGTST-&gt;MSGTST:500)
        </failure>
    </testcase>
</testsuite>
```

`<properties>` にライブラリー・リストと OS / iRPGUnit のバージョンが入るので、
**どの環境で回したかが成果物だけで分かる**。

### スプール

**名前は `RPGUNIT`**（`QSYSPRT` ではない。`QSYSPRT` で探すと 0 件になり
「メッセージが無い＝成功」と誤読する）。**`USER_DATA` にテスト対象のプログラム名**が入る。

```sql
SELECT SPOOLED_FILE_NAME, FILE_NUMBER, USER_DATA, JOB_NAME
  FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC
 WHERE SPOOLED_FILE_NAME = 'RPGUNIT' AND USER_DATA = '<テスト対象のプログラム名>'
```

**`RUCRTRPG` が出すコンパイル・リストは別物**で、そちらは**プログラム名**のスプールになる。

```
*** Tests of FIXTST2 ***
iRPGUnit    : v4.0.3
IBM i       : V7R3M0
TESTFAIL - FAILURE
Expected 2, but was 3.
  TESTFAIL (FIXTST2->FIXTST2:900)
-----------------------
FAILURE. 2 test cases, 2 assertions, 1 failure, 0 error.
```

**集計行は成功と失敗で表記が揃っていない**（実測）。parse するなら大小文字を無視し、単複を許す。

```
Success. 1 test case, 1 assertion, 0 failure, 0 error.
FAILURE. 2 test cases, 2 assertions, 1 failure, 0 error.
```

---

## 5. 日本語は載らない（日本語機で効く制約）

RPGUnit の出力は**ラテン系のコードページ**で作られる（他社機でビルドされており、
プログラム内のリテラルがそのまま焼かれている）。

- **XML**: ファイルの CCSID は **819（ISO 8859-1）**。宣言は `encoding="UTF-8"` だが実体は
  Latin-1。**`fail('日本語')` は `message=""` になる**（同じ実行の ASCII 側は正しく載る）。
- **スプール**: 日本語 CCSID の表示装置では **ASCII まで化ける**（小文字がカタカナになる）。
  `DSPSPLF` を 5250 で開いて確認済み。同じ画面のサインオン／メインメニューは正しく出るので、
  エミュレーターではなく**スプールのデータだけが他と違うコードページ**にある。
- `CHGJOB CCSID(37)` では直らない。**`CHRID` でも救えない**（実機で確認済み）:
  `CHGSPLFA` に `CHRID` は無く（`CPD0043`）、作成時に
  `OVRPRTF FILE(QSYSPRT) CHRID(697 37)` を掛けても表示は変わらない。
  **上書き自体は届いている**——同じ上書きに `SPLFNAME(CHRQ)` を足すとスプール名が
  変わるので、RUCALLTST が `QSYSPRT` を開いていることも同時に確かめられる。
- **プログラムから読む分には困らない。** `NetPrintConnection.readSpooledPages`
  （`ibmi-remote` 6 節）がラテン系でデコードするので、**ASCII は正しく読める**
  （日本語は元々出力側で失われている）。自動化はこちらを使う。
- **ソースメンバー側は正しい**（`CPYTOSTMF … STMFCCSID(1208)` で往復する）。落ちているのは出力側。

→ **レポートに出す文字は ASCII で書く。** 日本語で表現したいならテスト手続きの名前に寄せる。

---

## 6. 踏みやすい罠

- **`RPGUNIT` を `*LIBL` に載せる。** `TESTCASE` が入れ子で**非修飾の**
  `/include qinclude,TEMPLATES` を持つので、**外側の `/COPY` を修飾しても足りない**。
- **CL の中では `RPGUNIT/RUCRTRPG` と修飾する。** コマンド解決は**コンパイル時**なので、
  実行時の `ADDLIBLE` では間に合わず `CPD0030 Command … not found` になる。
- **バッチは `INQMSGRPY(*DFT)` を付ける。** 監視していない例外が照会メッセージになり、
  **ジョブが `MSGW` のまま残る**（実際に 150 秒以上残し `ENDJOB` で回収した）。
- **`RUCRTRPG` は既定の 20 秒では終わらない。** `CommandConnection.connect({ timeoutMs })`
  を伸ばすか `SBMJOB` で切り離す。
- **`XMLSTMF` の存在しないディレクトリは CL の*コンパイル時*に弾かれる。**
  妥当性検査プログラム（`RUCALLTSTV`）が効き、`CPD0006` → `CRTBNDCL` が `CPF0820`。
  出力先を実行時に決めたいなら CL 変数にする。
- **スプールは消さない。** 他の作業の証跡を巻き込む。名前を報告するに留める。

---

## 7. 例題

実機に 19 本ある（`RPGUNIT/QTESTCASES,TESTPGM01`〜`19`）。
テンプレートは `QSRC,TEMPLATE`（通常）と `QSRC,TEMPLSQL`（SQL）。

本 PJ が作った再現物は `ASAOLIB` にある。

| 名前 | 何を示すか |
|---|---|
| `FIXTST2` | 固定長で合格・失敗の両方 |
| `SQLFIX` / `SQLFREE` | 固定長 SQLRPGLE と `**free` の対照 |
| `EXCTST` | 例外（`MCH1211`）の検証 |
| `MSGTST` | ASCII と日本語のメッセージの差 |

ソースは `ASAOLIB/QUNITSRC`、実行用の CL driver は同ライブラリーの `RUDRV*`。
