# 要件: RPGUnit の実行ロジックを VS Code と skill で共通にする

## 背景 / 課題

RPGUnit のテストを実行する仕組みが 2 つ、別々に実装されている。

- VS Code の Test Explorer 統合（`vscode-extension/src/testing/`。PR #178〜#180）
- AI エージェント向けの skill `rpgunit-test` が使う `tools/run-rpgunit.mjs`

テストソースの書き方は同じだが、実行の挙動が食い違っている（2026-09-26 に両方のソースを直読して確認）。

- **コンパイル成否の判定**: 道具はオブジェクトの有無で判定している（`tools/run-rpgunit.mjs` の `objectExists`）。
  前回の `*SRVPGM` が残っていると失敗を成功と取り違え、古いテストを走らせる——VS Code 側では PR #179 で
  直した欠陥が、道具には残っている。
- **バインド指定**: VS Code は `testing.json` を読み、修飾の無い名前を `*LIBL` で解決する（PR #180）。
  道具は `--bnd` だけを読み、修飾の無い名前をテストのライブラリーで補う。同じテストでも解決先が変わりうる。
- **ライブラリー・リスト**: VS Code は `RPGUNIT`・テストのライブラリー・利用者の設定、道具は
  `RPGUNIT`・テストのライブラリー・`QGPL`・`QTEMP`。
- **結果 XML**: VS Code は実行前に消す。道具は消さない（`--keep` で残した XML を次回読みうる）。

同じ修正を 2 か所に当て続ける限り、片方だけ直る食い違いは今後も起きる。

## 目的 / ゴール

RPGUnit のテストを VS Code から実行しても skill（`tools/run-rpgunit.mjs`）から実行しても、コンパイル・
バインド・実行・結果の判定が**同じ実装**で行われ、違うのは IBM i への接続手段（Code for IBM i か
ts5250 の hostserver か）と、呼び出し側が与える既定のライブラリー・リスト（VS Code は利用者の設定、
道具は `QGPL`・`QTEMP`）だけである状態。

紐づく charter ゴール: IBM i 開発ワークフロー支援（第 6 の柱）

## ユーザーストーリー

- US1: AI エージェント（skill `rpgunit-test`）として、テスト結果を信頼したい。なぜなら、古い `*SRVPGM` のまま
  「合格」と報告すると、壊れたコードを合格として先へ進めてしまうから。（受け入れ: AC2, AC5, AC10）
- US2: VS Code とエージェントの両方でテストを回す開発者として、同じ `testing.json` で同じバインドになってほしい。
  なぜなら、どちらで回したかで結果が変わると、どちらを信じればよいか分からないから。（受け入れ: AC1, AC3, AC4, AC6, AC10, AC13）
- US3: この PJ の保守者として、実行ロジックを 1 か所で直したい。なぜなら、2 か所に書いたものは片方だけ直って
  食い違うから（実際に起きている）。（受け入れ: AC7, AC11）
- US4: skill の利用者として、道具のこれまでの機能と使い方がそのまま使えてほしい。なぜなら、手順書（skill）や
  自律ループがその出力と終了コードに依っているから。（受け入れ: AC8, AC9, AC12）

## スコープ

### 対象

- コマンド組み立て・`testing.json` の解釈と探し方・結果 XML の解析・コンパイル〜実行の手順を、VS Code に
  依存しない共通部品にし、VS Code 側と `tools/run-rpgunit.mjs` の両方がそれを使う。
- `tools/run-rpgunit.mjs` の接続部分を、共通部品が求める接続の形に合わせる（hostserver で実装）。
- `tools/README.md` と skill `rpgunit-test` の記述を、変わった挙動（`testing.json`・`--bnd` の解釈）に合わせる。

### 対象外

- MCP（ts5250）への RPGUnit 用の道具の追加。
- テストソースを IFS に展開する方式（backlog 起票済み）。
- 道具だけにある機能（オラクル印・独立性の検査・Markdown レポート・JSON 出力）を VS Code 側へ持ち込むこと。
- ts5250 の hostserver ライブラリーの変更。

## 機能要件

- FR1: 共通部品は `vscode` を import しない。VS Code 側・道具の両方から使える。
- FR2: コンパイルの成否は `RUCRTRPG` の結果で判定する（オブジェクトの有無で判定しない）。
- FR3: コンパイル・実行のライブラリー・リストは共通の規則（`RPGUNIT`・テストのライブラリー・呼び出し側の
  既定リスト）で作る。道具の既定リストは `QGPL`・`QTEMP`。
- FR4: 道具は `testing.json` を VS Code（PR #180）と同じ規則で探して読む。ソースのディレクトリーから親へ
  上端まで遡り、最初に見つかったものを「最寄り」とする。上端の `.vscode/testing.json` も読む。
  `bndSrvPgm`／`bndDir` のキーごとに、最寄りにあれば最寄りの値を（配列ごと）採る。探す範囲の上端は、
  ソースを含む git リポジトリーの最上位（git でなければソースのディレクトリー）で、それより上は読まない。
- FR5: 道具の `--bnd` は `testing.json` の `bndSrvPgm` より優先する（コマンドラインで明示したものを採る）。
  修飾の無い名前は補わず `*LIBL` で解決させる（`testing.json` と同じ解釈）。
- FR6: 結果 XML は `RUCALLTST` の前に消す。
- FR7: `testing.json` が誤っていれば、道具はコンパイルせず終了コード 2 で終わり、パスと理由を出す。
  「誤り」は PR #180 と同じ——JSON として読めない／存在するのに読めない／最上位・`rpgunit`・
  `rpgunit.rucrtrpg` がオブジェクトでない／`bndSrvPgm`・`bndDir` が文字列の配列でない／名前が `NAME` か
  `LIB/NAME` の形でない／件数が上限（50・10）を超える。ほかのキーは無視する（誤りにしない）。
- FR8: VS Code 側と道具は、コマンド組み立て・`testing.json` の解釈と探し方・結果 XML の解析・コンパイル〜実行の
  手順について**同じ共通部品の関数を使い**、道具に独自の実装を残さない。

## 非機能要件 / 制約

- 道具の終了コード（0=全合格／1=テスト失敗／2=道具の異常）と既存のオプションを変えない。例外は 2 つで、
  利用者向け文書に書く: FR5 の `--bnd` の解釈、`--keep` を付けても実行前の結果 XML は消す（FR6）、
  ビルド失敗時の表示（「次に読む先」のスプールの一覧に代えて、ジョブログを出す。design「ドメイン固有の考慮」。D9）。
- 道具の `--self-test` は CI（`.github/workflows/tools-tests.yml`）で回り続ける。
- 実機 E2E で両方の経路を確かめる（`20260922-rpgunit-vscode-testing` の D8）。

## 完了条件 (受け入れ基準)

- [ ] AC1: 道具と VS Code が同じ `RUCRTRPG`／`RUCALLTST` のコマンドを組み立てる（同じ共通部品の関数を使う）。
- [ ] AC2: 道具で、前回の `*SRVPGM` が残ったままコンパイルが失敗すると、テストを実行せず終了コード 2 になる
      （実機で確認。修正前の道具は古いテストを走らせることも実機で確認する）。
- [ ] AC3: 道具が、FR4 の規則で見つけた `testing.json` の `bndSrvPgm`／`bndDir` を `RUCRTRPG` に渡す
      （実機で、バインドが要るテストが合格する）。上端より上の `testing.json` は読まず、git でないときは
      ソースのディレクトリーだけを見る。上端の `.vscode/testing.json` も読み、キーごとに最寄りを優先する（単体テスト）。
- [ ] AC4: 道具の `--bnd NAME` は `testing.json` の `bndSrvPgm` より優先し、`NAME` は修飾されずに渡る。
- [ ] AC5: 道具が `RUCALLTST` の前に結果 XML を消す。
- [ ] AC6: 誤った `testing.json` では、道具がコンパイルせず終了コード 2 で、パスと理由を出す。FR7 の 6 種類と
      「ほかのキーは誤りにしない」ことは共通部品の単体テストで確かめ（道具と VS Code が同じ関数を使うので
      一度でよい）、道具が誤りを終了コード 2 にすることは実機 E2E で 1 種類（`bndSrvPgm` が文字列）を確かめる。
- [ ] AC7: 共通部品のファイルが `vscode` を import していないことを単体テストが見張る。道具が FR8 の 4 つ
      （コマンド組み立て・`testing.json` の解釈と探し方・XML 解析・コンパイル〜実行の手順）を共通部品の関数で行い、
      独自実装を残していないことを、道具の self-test が道具自身のソースを読んで確かめる（`RUCRTRPG`／`RUCALLTST`
      のコマンド文字列・`<testcase` の解析・`testing.json` の探索・`OBJECT_STATISTICS` による成否判定が道具に無い）。
- [ ] AC8: 道具の既存機能（オラクル印の検査・`--check-independence`・`--md`・`--json`・`--xml`・`--order`・
      `--rclrsc`・`--no-tgtccsid`・`--keep`）と終了コードが従来どおり動く（`--self-test` と実機）。
      `--keep` は実行後に作業ファイルを消さないだけで、実行前の結果 XML の削除（FR6）は常に行う。
- [ ] AC9: VS Code の Test Explorer 統合の挙動が変わらない（単体テスト全件と、既存の実機 E2E
      `vscode-extension/dev/rpgunit-e2e.mjs` の 12 項目。PR #179・#180 で追加したもの）。
- [ ] AC10: 実機 E2E で、道具の経路について「正常（合格・失敗の判定）」「古い `*SRVPGM` で失敗」
      「`testing.json` によるバインドで合格」「`--bnd` で合格」が確かめられる。
- [ ] AC11: CI の `tools self-test` が通る（共通部品のビルドを含む）。
- [ ] AC12: `tools/README.md` と skill `rpgunit-test` に `testing.json` の使い方・`--bnd` の解釈・`--keep` と
      実行前の XML 削除の関係・共通部品のビルドの前提・ビルド失敗時の表示が書かれている。
- [ ] AC13: ライブラリー・リストが共通の規則で作られる——道具は `RPGUNIT`・テストのライブラリー・`QGPL`・`QTEMP`、
      VS Code は `RPGUNIT`・テストのライブラリー・利用者の設定（単体テストで両方の入力を確かめ、道具は実機でも
      バインドの無いテストが `RPGUNIT` の `/include` を解決できることで確かめる）。

## 未確定事項 / 確認したいこと

- ~~hostserver の SQL ジョブで失敗が `SqlError` として返り、ジョブログが読めるか~~ → 解消済み。
  2026-09-26 に実機で確認（decisions.md D6）。`CHGLIBL` の持ち越し・`SqlError -443`・`QSYS2.JOBLOG_INFO` いずれも可。
- ~~`RUCALLTST` を SQL ジョブで実行したときに XML が書かれるか~~ → 解消済み（decisions.md D8）。
