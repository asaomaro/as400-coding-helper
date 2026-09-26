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

**VS Code の Test Explorer と同じ実装で動く。** コマンドの組み立て・`testing.json` の読み方・
結果 XML の解析・コンパイル〜実行の手順は `vscode-extension/src/testing/` の共通部品
（`suiteRunner` / `testingConfigCore` / `resultParser` / `rpgunitCommands`）を呼ぶ。道具が自前で持つのは
接続（ts5250 の hostserver）と、道具だけの機能（オラクルの印・独立性・レポート）。
以前は 2 か所に書いていて、ビルドの成否の判定・バインドの解釈・ライブラリー・リストが食い違っていた
（古い `*SRVPGM` が残っているとコンパイル失敗を「ビルド OK」と報告し、古いテストを走らせていた）。

### 前提

- **共通部品のビルド**: `cd vscode-extension && npm install && npm run compile`。
  道具は `vscode-extension/out/testing/*.js` を読む。無ければ何を打てばよいかを出して終了コード 2。
- `/workspaces/ts5250` のチェックアウトとビルド、およびそこの `--env-file`。
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

ビルドに失敗したときは**ジョブログ**を出す（終了コード 2）。成否は `RUCRTRPG` の結果で決める
——オブジェクトの有無では見ない（前回の `*SRVPGM` が残っていると失敗を成功と取り違える）。

```
✗ ビルド失敗   RUE2ETST
  ジョブログ:
    …
    RNS9308: コンパイルは停止しました。重大度30のエラーがプログラムで見つかりました。
    RNS9309: コンパイルは正常に実行されなかった。モジュールRUE2ETSTがライブラリーASAOLIBに作成されませんでした。
    CPF9897: …
```

**行ごとの理由はコンパイル・リストにしか無い。** スプール名はプログラム名（上の例なら `RUE2ETST`）。

### テスト対象をバインドする

自己完結のテストではなく**自分の手続きを検証する**なら、`testing.json` か `--bnd` で束ねる。

**`testing.json`**（IBM i Testing 互換。VS Code の Test Explorer と同じ読み方）を置けば、道具も同じ指定で束ねる。

```json
{ "rpgunit": { "rucrtrpg": { "bndSrvPgm": ["CALCSRV"], "bndDir": ["MYBNDDIR"] } } }
```

- ソースのディレクトリーから**git の最上位**まで遡って最寄りの 1 つと、最上位の `.vscode/testing.json` を読む。
  キーごとに最寄りが優先（git でなければソースのディレクトリーだけ）。
- 形が誤っていれば（配列でない・件数超過など）**どのファイルの何が誤りかを出して終了コード 2**。コンパイルしない。

**`--bnd`** は `testing.json` の `bndSrvPgm` **だけを置き換える**（`bndDir` はそのまま）。

```
node tools/run-rpgunit.mjs test/CALCTST.rpgle --bnd CALCSRV
node tools/run-rpgunit.mjs test/X.rpgle --bnd MYLIB/A --bnd MYLIB/B   # 繰り返し可
```

ライブラリーを省くと `*LIBL` で探す（`RUCRTRPG` の既定）。コンパイル時のライブラリー・リストは
`RPGUNIT <AS400_LIB> QGPL QTEMP` なので、`AS400_LIB` にあるものはそのまま見つかる。
形の検査は `testing.json` と同じ規則。**テスト対象のビルドは利用者側の仕事**で、
道具は束ねるだけ。動く一式は [`example/`](example/) にある（対象を壊すとテストが
落ちることまで確かめてある）。

### IFS 方式（`*.test.rpgle`）

ソースメンバーの階層に置かない、IBM i Testing と同じ置き方のテストも回せる。**ファイル名が `.test.rpgle` / `.test.sqlrpgle`
で終われば IFS 方式**（大文字小文字は問わない。`src/` の下でも IFS 方式）。VS Code 側の使い方と規則は
[`docs/workflow/rpgunit-test-explorer.md`](../docs/workflow/rpgunit-test-explorer.md)。

```
node tools/run-rpgunit.mjs test/calc.test.rpgle
▸ 転送     3 ファイル → /home/ASAO/rpgunit/myrepo  （テスト test/calc.test.rpgle → ASAOLIB/TCALC）
▸ ビルド   TCALC … OK (2.1s)
```

- **送るもの**: git の最上位（`testing.json` を探す上端と同じ）の RPG ソース（`.rpgle` `.sqlrpgle` `.rpgleinc` `.rpginc` `.inc` `.cpy`）を、
  同じ相対パスで `<AS400_IFS_DIR>/rpgunit/<最上位のディレクトリ名>/` へ送る（CCSID タグ 1208）。追跡済みと、無視されていない未追跡の両方
  （書いたばかりのコピー句も届く）。git でなければテストのディレクトリの直下だけ。
- **名前**: `--pgm` 省略時は IBM i Testing と同じ規則（`calc.test.rpgle` → `TCALC`。規則は上の文書）。作れなければ `--pgm` を促して終了コード 2。
  ライブラリーはメンバー方式と同じ `--lib` / `AS400_LIB`。
- **コンパイル**: テストの主ソースだけを `CPY … TOCCSID(*JOBCCSID) DTAFMT(*TEXT)` で写してから `RUCRTRPG SRCSTMF`。7.3 の日本語環境では
  UTF-8 のまま渡すと `CPE3490` で開けないため（実機で確認）。`/COPY` の相対パスは **テストのディレクトリ → 送信の最上位** の順に探す。
- **片付け**: 実行後、送ったファイルと**この実行で作ったディレクトリだけ**を消す（`--keep` なら残す。変換した写しと結果 XML も同じ）。
- 変換・ビルドの失敗は終了コード 2 とジョブログ。IFS へ送れなければ終了コード 2。

### Markdown のレポート

```
node tools/run-rpgunit.mjs test/X.rpgle --md build/rpgunit.md
```

**書式は `.claude/skills/rpgunit-test/templates/test-report.md`** を実行時に読む。
テンプレートを直せば出力が変わる（コードは触らない）。失敗時・独立性の食い違い時も出る。

### 期待値の出所を検品する

```
node tools/run-rpgunit.mjs test/X.rpgle --require-oracle
```

各テスト手続きに**オラクルの印**（`VERIFICATION` / `CHARACTERIZATION`）と
**根拠の行**（`オラクル:` / `期待値の出所:`）があるかを見る（skill
`rpgunit-test` §0.2）。**既定は警告**で実行は続き、レポートに載る。
`--require-oracle` は**走らせずに終了コード 1**——出所不明のまま走ると
「緑のレポート」が出来てしまうため。

実装を読んで書いた期待値は**バグごと固定して検出力ゼロで緑になる**。
印はそれを「特性化テスト」と名乗らせるための仕掛けで、**印と根拠は対**。
単語だけの `VERIFICATION` は名乗りの偽装なので通らない。

**印の中身が正しいか（引用した条項が実在するか）は検査しない。人が読む。**

実行後に**実機が報告したテスト名と突き合わせる**。ソースから読めなかった手続きは
出所不明として扱う（読み落としがあると検品ごと素通りするため）。

### 独立性を検品する

```
node tools/run-rpgunit.mjs test/X.rpgle --check-independence
```

正順と逆順を両方走らせ、**合否が食い違えば終了コード 1**。順序依存は正順だけでは
緑なので、これが唯一の機械的な検出手段になる。`--order api|reverse` で片方だけ、
`--rclrsc always` で活動化グループを毎回作り直す。

### CI で使う

`--xml` で JUnit XML を保存すれば、そのままテストレポーターに渡せる。

```yaml
- run: |
    cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify \
      $GITHUB_WORKSPACE/tools/run-rpgunit.mjs src/MYTEST.rpgle --require-oracle \
        --xml $GITHUB_WORKSPACE/rpgunit.xml --md $GITHUB_WORKSPACE/rpgunit.md
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: rpgunit, path: "rpgunit.*" }
```

**ただし実機に届く runner が要る。** GitHub の hosted runner からは SR-OSAKA に繋がらない。

### 閉じ込めてある罠（利用者は知らなくてよい）

| 罠 | 道具側の扱い |
|---|---|
| `SRCMBR` はプログラム名と揃える（別名は `CPF9815`） | **メンバー名は常にプログラム名**。選ばせない |
| `CHGPFM SRCTYPE(SQLRPGLE)` の忘れ | 拡張子から決める。`--srctype` で上書き可 |
| `RPGUNIT` が `*LIBL` に無いと `TESTCASE` の `/include` が `CPF4102` | コンパイル・実行の間だけ `CHGLIBL` で `RPGUNIT <lib> QGPL QTEMP` にする（共通部品） |
| `RUCALLTST` はテストが失敗すると自身も失敗を返す（`CPF9897`） | 合否は XML で決める（共通部品） |
| オブジェクトの有無でビルドの成否を見ると、古い `*SRVPGM` で取り違える | `RUCRTRPG` の結果で決める（共通部品） |
| 既定 20 秒のソケット時間切れでは `RUCRTRPG` が終わらない | SQL ジョブを `timeoutMs: 300000` で張る |
| コンパイル・リストのスプール名はプログラム名 | ビルド失敗時はジョブログを出す。行ごとの理由はリストを読む |

接続は hostserver の SQL ジョブ 1 本で `QSYS2.QCMDEXC` を呼ぶ（Code for IBM i と同じ方式）。
以前の `SBMJOB` による投入はやめたので、実行のたびにジョブのスプール（`QPJOBLOG` など）が残ることは無い。

### 既知の制約

- **日本語は結果に載らない。** XML は CCSID 819（ISO 8859-1）で作られるため、
  `fail('日本語')` は `message=""` になる。**レポートに出す文字は ASCII で書く。**
- **実機が要る。** CI では回せない。純粋な部分だけ `--self-test` で確かめられる。

```
$ node tools/run-rpgunit.mjs --self-test
```

- 作った `*SRVPGM` とソースメンバーは**残す**（再実行の材料）。
  IFS の作業ファイル（転送したソースと結果 XML）は消す（`--keep` で残せる）。**スプールは消さない**。
- **結果 XML は実行の前に必ず消す**（`--keep` でも）。パスは毎回同じなので、残っていると
  `RUCALLTST` が結果を書かなかったときに前回の結果を読んでしまう。

### 実機 E2E

道具そのものを実機で確かめる（正常・古い `*SRVPGM`・`testing.json`・`--bnd`・誤った `testing.json`・
各オプション・IFS 方式（コピー句・日本語・UTF-8 のまま渡すと開けない対照）・片付けて残存ゼロ）。テストソースは VS Code 側の E2E（`vscode-extension/dev/rpgunit-e2e.mjs`）と
共有している（`vscode-extension/dev/rpgunit-e2e-fixtures.mjs`）。

```sh
cd /workspaces/ts5250 && node --env-file=.env --env-file=.env.verify \
  /workspaces/as400-coding-helper/tools/run-rpgunit-e2e.mjs
```
