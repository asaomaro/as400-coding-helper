# tools/

**実機（IBM i）に触る開発用の道具。** 本体のビルドにも CI にも含まれない。

CI は `.github/workflows/` が名指しした script だけを実行するので、ここに何を置いても
CI は触らない。逆に言えば**ここのものは CI では検証されない**——実機でしか確かめられない。

## run-rpgunit.mjs

RPGUnit のテストを **1 コマンドで回して結果を採る**。

```
node tools/run-rpgunit.mjs <ソース> [--pgm 名前] [--srctype RPGLE|SQLRPGLE]
                                    [--xml <保存先>] [--json] [--keep]
```

転送 → ビルド → 実行 → 結果採取。**終了コードは `0`=全合格 / `1`=テスト失敗 /
`2`=道具の異常**（ビルド失敗・前提不足はこちら。CI が「落ちた」と「回せなかった」を
区別できるように分けてある）。

### 前提

`/workspaces/ts5250` のチェックアウトとビルド、およびそこの `--env-file`。
**`.env` の中身は読まない**（あちらの規約）。識別子は `.env.verify` から取る。

```sh
cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify \
  /workspaces/as400-coding-helper/tools/run-rpgunit.mjs <ソース>
```

足りないものがあれば**何が無いかを列挙して終了コード 2 で落ちる**。
`TS5250_DIR` で場所を変えられる。

RPGUnit 自体の導入は [`docs/workflow/rpgunit-install.md`](../docs/workflow/rpgunit-install.md)。
テストの書き方は skill `rpgunit-test`。

### 例

```
$ … run-rpgunit.mjs test/RUNNG.rpgle --xml build/rpgunit.xml
▸ 転送     RUNNG.rpgle → ASAOLIB/QUNITSRC(RUNNG)  [RPGLE]
▸ ビルド   RUNNG … OK (5.5s)
▸ 実行     RUNNG … 2 tests, 1 failure (13.8s)

  ✗ TESTBAD  TESTBAD (RUNNG->RUNNG:900)
      Expected 2, but was 3.

FAILURE  2 tests, 1 failure, 0 error
（終了コード 1）
```

ビルドに失敗したときは**次に読む先**を出す。

```
✗ ビルド失敗   RUNBAD が作成されませんでした
  次に読む先（スプールは消していません）:
    RUNBAD #1  JOB(151901/ASAO/RUBH39NC)
    QPJOBLOG #2  JOB(151901/ASAO/RUBH39NC)
```

### テスト対象をバインドする

自己完結のテストではなく**自分の手続きを検証する**なら `--bnd` を使う。

```
node tools/run-rpgunit.mjs test/CALCTST.rpgle --bnd CALCSRV
node tools/run-rpgunit.mjs test/X.rpgle --bnd MYLIB/A --bnd MYLIB/B   # 繰り返し可
```

ライブラリーを省くと `AS400_LIB` で補う。**テスト対象のビルドは利用者側の仕事**で、
道具は束ねるだけ。動く一式は [`example/`](example/) にある（対象を壊すとテストが
落ちることまで確かめてある）。

### CI で使う

`--xml` で JUnit XML を保存すれば、そのままテストレポーターに渡せる。

```yaml
- run: |
    cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify \
      $GITHUB_WORKSPACE/tools/run-rpgunit.mjs src/MYTEST.rpgle --xml $GITHUB_WORKSPACE/rpgunit.xml
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: rpgunit, path: rpgunit.xml }
```

**ただし実機に届く runner が要る。** GitHub の hosted runner からは SR-OSAKA に繋がらない。

### 閉じ込めてある罠（利用者は知らなくてよい）

| 罠 | 道具側の扱い |
|---|---|
| `SRCMBR` はプログラム名と揃える（別名は `CPF9815`） | **メンバー名は常にプログラム名**。選ばせない |
| `CHGPFM SRCTYPE(SQLRPGLE)` の忘れ | 拡張子から決める。`--srctype` で上書き可 |
| `SBMJOB` の `INLLIBL` ＋ `RPGUNIT/` 修飾 | 必ず付ける |
| `INQMSGRPY(*DFT)` 無しでジョブが `MSGW` で残る | 必ず付ける |
| 既定 20 秒のソケット時間切れ | `timeoutMs: 120000` ＋ `SBMJOB` で切り離す |
| 結果のスプール名は `RPGUNIT`、コンパイル・リストはプログラム名 | 失敗時に名前を出す |

### 既知の制約

- **日本語は結果に載らない。** XML は CCSID 819（ISO 8859-1）で作られるため、
  `fail('日本語')` は `message=""` になる。**レポートに出す文字は ASCII で書く。**
- **実機が要る。** CI では回せない。純粋な部分だけ `--self-test` で確かめられる。

```
$ node tools/run-rpgunit.mjs --self-test
```

- 作った `*SRVPGM` とソースメンバーは**残す**（再実行の材料）。
  IFS の作業ファイルは消す（`--keep` で残せる）。**スプールは消さない**。
