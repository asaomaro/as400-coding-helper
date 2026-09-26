# 要件: RPGUnit のテストを IFS に展開してコンパイル・実行できるようにする

## 背景 / 課題

いまの RPGUnit 統合（VS Code の Test Explorer と skill の道具 `tools/run-rpgunit.mjs`。PR #178〜#181）は、
テストソースを**ソースメンバーへ送ってコンパイルする方式だけ**を持つ。ローカルのファイルは
`src/<LIB>/<SRCFILE>/<MEMBER>.rpgle` に置く決まりで（ソースメンバー同期と同じ対応づけ）、
`RUCRTRPG SRCFILE(...) SRCMBR(...)` でコンパイルする。

一方、IBM i Testing 拡張（IBM 公式。`IBM/vscode-ibmi-testing`、`259485a888` を 2026-09-26 に直読）は、
ローカルの `*.test.rpgle` をワークスペースのどこに置いてもよく、Code for IBM i のデプロイで IFS へ送り、
`RUCRTRPG SRCSTMF(<デプロイ先>/<相対パス>)` でコンパイルする（`api/runner.ts` 229-300 行）。

- ソースを git で管理する現代的な構成（IFS 上のソース・`/COPY` を IFS の相対パスで書く）では、
  テストもメンバーではなくファイルとして置きたい。いまはそれを Test Explorer から実行できない。
- `testing.json` を IBM i Testing 互換にした（PR #180）目的の一つは、将来 IBM i Testing と差し替えられることだった。
  テストファイルの置き方が片方にしか無いと、その差し替えも、IBM i Testing 向けに書かれたテスト一式を
  この拡張で回すこともできない。

backlog `workflow.md`「RPGUnit の Test Explorer 統合で、テストソースを IFS に展開してコンパイルする方式にも対応する」
（2026-09-26 ユーザー要望）から起こした work。

### 実機で分かっていること（2026-09-26・SR-OSAKA・IBM i 7.3・RPGUnit v6.0.2.r）

`verify/probe-srcstmf.mjs` と `verify/probe-stmf-ccsid.mjs` で確かめた。

- **`RUCRTRPG` は `SRCSTMF` を受け付ける**（パラメーターの誤りにはならず、コンパイラーまで届く）。
- **中身が同じでも、ストリーム・ファイルに付いた CCSID で結果が変わる**（ジョブの CCSID は 5035）。
  - タグ `1208`（UTF-8）: `CPE3490 変換エラー` → `RNS9339 ファイルを開くことができません`。**中身が ASCII だけでも開けない**。
  - タグ `819` / `1252`: 作成でき、`RUCALLTST` で 2 件中 1 件失敗（期待どおり）。`/COPY RPGUNIT/QINCLUDE,TESTCASE`
    （メンバー形式のコピー）はストリームのソースからでも解決された。
  - タグ `943`（Shift-JIS）: `CPF427D`（置換文字）・重大度 40 で作成できない。
  - 対照: `CHGJOB CCSID(5035)` を明示しても 1208 の結果は変わらない（ジョブの CCSID が原因ではない）。
- つまり**方式そのものは 7.3 で成り立つが、ファイルの文字コードの扱いを決めないと日本語環境で動かない**。
  VS Code で書くソースは UTF-8 が普通で、この PJ の利用者は日本語の注記を書く。

## 目的 / ゴール

RPGUnit のテストソースを、ソースメンバーの配置（`src/<LIB>/<SRCFILE>/<MEMBER>.rpgle`）に縛られずにワークスペースの
好きな場所へ置き（IBM i Testing と同じ `*.test.rpgle` の置き方）、VS Code の Test Explorer からも skill の道具からも、
IFS のソースとしてコンパイル・実行・結果確認ができる状態。日本語の注記を含む UTF-8 のソースでも動き、
これまでのメンバー方式のテストはそのまま動き続ける。

紐づく charter ゴール: IBM i 開発ワークフロー支援（第 6 の柱）

## ユーザーストーリー

- US1: ソースを git と IFS で管理している開発者として、テストを `test/` などの好きなディレクトリに `*.test.rpgle` で
  置き、Test Explorer から実行したい。なぜなら、ソースメンバーの階層を真似たディレクトリを作らずに済み、
  アプリのソースと同じ置き方でテストを管理できるから。（受け入れ: AC1, AC2, AC3, AC7）
- US2: 日本語の注記を書く開発者として、UTF-8 で保存したテストがそのままコンパイルされてほしい。
  なぜなら、文字コードを意識して保存し直すのは手間で、間違えると原因の分かりにくい失敗になるから。（受け入れ: AC4, AC5）
- US3: テストから共通の定義を `/COPY` している開発者として、IFS の相対パスのコピー句も、これまでのメンバー形式の
  コピー句も解決されてほしい。なぜなら、RPGUnit 自身の `TESTCASE` はメンバー形式で、アプリのコピー句は
  IFS に置くことが多いから。（受け入れ: AC3, AC6）
- US4: AI エージェント（skill `rpgunit-test`）として、同じ `*.test.rpgle` を道具からも同じ結果で回したい。
  なぜなら、VS Code と道具で判定が食い違わないことを前の work（#181）で揃えたから。（受け入れ: AC8）
- US5: いまメンバー方式でテストを書いている開発者として、何も変えずにこれまでどおり動いてほしい。
  なぜなら、既存のテストを書き直す理由が無いから。（受け入れ: AC9, AC14）
- US6: テスト対象のサービスプログラムをバインドしてテストする開発者として、IFS 方式でも `testing.json` のバインド指定が
  そのまま効いてほしい。なぜなら、方式によって書く場所が変わると、同じテストを両方式で回せないから。（受け入れ: AC11）
- US7: 利用者として、IFS へ展開できない・コンパイルできないときに、何を直せばよいか分かってほしい。
  なぜなら、展開先の設定漏れや文字コードの問題は、既定のメッセージでは原因が分からないから。（受け入れ: AC10）

## スコープ

### 対象

- VS Code の Test Explorer: IFS 方式のテストファイルの検出・実行・結果表示（メンバー方式と並べて出す）。
- skill の道具 `tools/run-rpgunit.mjs`: IFS 方式のテストファイルを渡したときに、同じ共通部品で IFS 方式として回す。
- IFS へ置いたテストソースの文字コードの扱い（日本語の注記を含む UTF-8 を正しくコンパイルさせる）。
- `/COPY`・`/INCLUDE` の解決（IFS の相対パス・メンバー形式の両方）。
- `testing.json` の既存のキー（`bndSrvPgm` / `bndDir`）を IFS 方式にも効かせる。
- `tools/README.md`・skill `rpgunit-test`・`docs/workflow/rpgunit-test-explorer.md`（新規）の記述。

### 対象外

- IFS 上に**既にある**テストファイル（Code for IBM i の IFS ブラウザーから開いたもの）を直接実行すること。
  ローカルのワークスペースにあるテストファイルが対象。
- COBOL（`*.test.cblle` 等）。この PJ の対象言語ではない。
- コード・カバレッジ（前の work で対象外にしたまま）。
- ソースメンバー同期（第 5 の柱）の対応づけの変更。
- IBM i Testing の `testing.json` のうち、`bndSrvPgm` / `bndDir` 以外のキー（`incDir` を含むコンパイル・オプション）の解釈。
  コピー句の解決（FR6）に `incDir` の読み取りが要ると design で判断した場合だけ、そのキーを足す。

## 機能要件

- FR1: ワークスペース内の `*.test.rpgle` / `*.test.sqlrpgle`（大文字小文字を問わない。IBM i Testing と同じ接尾辞）を
  IFS 方式のテストファイルとして検出する。置き場所の制約は設けない（ただし FR2 でメンバー方式になるものは除く）。
- FR2: メンバー方式（`src/<LIB>/<SRCFILE>/<MEMBER>.rpgle`）で検出されるファイルは、これまでどおりメンバー方式で扱う。
  1 つのファイルがどちらの方式になるかは、利用者に見て分かる規則で一意に決まる。
- FR3: IFS 方式のテストは、テストソースを IFS へ置き、`RUCRTRPG SRCSTMF(...)` でテスト・サービスプログラムを作り、
  `RUCALLTST` で実行して結果を Test Explorer（道具では標準出力・終了コード）に出す（判定を共通部品で行うことは非機能要件）。
- FR4: テスト・サービスプログラムの名前とライブラリーは、ファイル名とワークスペースから利用者に予測できる規則で決まり、
  10 文字を超える名前でも IBM i の名前として正しいものになる。
- FR5: テストソースの文字コードは、ローカルのファイルが UTF-8 で日本語を含んでいても（注記と文字リテラルの両方）、IBM i 7.3 の日本語環境
  （ジョブ CCSID 5035）でコンパイル結果が正しくなるように扱う。
- FR6: テストソース中の `/COPY` / `/INCLUDE` は、IFS の相対パス（ワークスペース内のコピー句）とメンバー形式
  （`RPGUNIT/QINCLUDE,TESTCASE` など）の両方が解決される。IFS の相対パスのコピー句も、日本語（注記・文字リテラル）を含む UTF-8 のまま
  正しく読まれる（主ソースと同じ手段で扱うことは求めない。design で確定——decisions D6）。
- FR7: `testing.json` の `bndSrvPgm` / `bndDir` は IFS 方式でも同じ規則で効く。
- FR8: IFS へ展開できない（展開先が決まらない・書けない）、コンパイルできない場合は、そのファイルのテストを
  errored にし、原因と次に何をすればよいかを出す。

## 非機能要件 / 制約

- **接続・IFS 操作は Code for IBM i の公開 API に乗る**（charter）。独自の接続層を拡張機能の実行時要件として持たない。
  道具（`tools/run-rpgunit.mjs`。開発時に skill が使うもの）はこの制約の対象外で、これまでどおり ts5250 の hostserver を使う。
- **既存のメンバー方式の挙動を変えない**（単体テスト全件・`dev/rpgunit-e2e.mjs` の 12 項目・`tools/run-rpgunit-e2e.mjs` の 23 項目）。
- **VS Code と道具で同じ共通部品を使う**（#181 の方針。判定を 2 か所に書かない）。
- 実機は SR-OSAKA（IBM i 7.3・RPGUnit v6.0.2.r・ジョブ CCSID 5035）。**原典（IBM Documentation）の記述と実機が食い違ったら実機で判定する**（AGENTS.md）。
- IFS に書くのは、利用者が決めた（または文書に書いた既定の）展開先の配下と、これまでどおりの一時ディレクトリ（結果 XML を置く場所。
  使い終えたら消す）だけとし、実行後に何が残るかを `tools/README.md` と
  `docs/workflow/rpgunit-test-explorer.md` に書く（AC12）。

## 完了条件 (受け入れ基準)

- [ ] AC1: ワークスペース内の任意のディレクトリにある `*.test.rpgle` が Test Explorer に出る（テスト手続きごとの子項目も出る）。
      `src/<LIB>/<SRCFILE>/` の外に置いたものも出る。同じワークスペースのメンバー方式のテストと同時に出る（単体テストと実機 E2E）。
      `*.test.sqlrpgle` と大文字の接尾辞（`*.TEST.RPGLE`）も検出される（単体テスト）。
- [ ] AC2: IFS 方式のテストを Test Explorer から実行すると、合格・失敗が正しく出る（実機 E2E。前の work の E2E 部品
      `vscode-extension/dev/rpgunit-e2e-fixtures.mjs` の `basicSource` で、`TESTPASS` 合格・`TESTFAIL` 失敗、
      失敗メッセージ `Expected '2', but was '3'.`）。
- [ ] AC3: 同じワークスペース内の別ディレクトリにあるコピー句を IFS の相対パスで `/COPY` するテストが、コンパイル・合格する（実機 E2E）。
      対照として、コピー句が解決できない場合にコンパイル失敗（errored）になることも確かめる。
- [ ] AC4: 日本語の注記と日本語の文字リテラルを含む UTF-8 のテストソース（IFS 方式）がコンパイル・実行でき、合格・失敗の件数と
      失敗メッセージが AC2 と同じになる。日本語の注記を含む UTF-8 のコピー句を IFS の相対パスで `/COPY` しても同じく合格する（実機 E2E）。
- [ ] AC5: 対照として、同じ UTF-8 のソースを CCSID タグ 1208 のまま置いて `RUCRTRPG SRCSTMF` に渡すと `CPE3490` / `RNS9339`
      になることを実機で再現する（背景の事実を、この work の E2E 部品でも再現できることの確認）。
- [ ] AC6: IFS 方式のテストから `/COPY RPGUNIT/QINCLUDE,TESTCASE`（メンバー形式）が解決される（AC2 の実機 E2E に含む）。
- [ ] AC7: テスト・サービスプログラムの名前とライブラリーの決め方が単体テストで確かめられ、10 文字を超えるファイル名でも
      正しい名前になる。決め方は `tools/README.md` と `docs/workflow/rpgunit-test-explorer.md` に書かれている。
- [ ] AC8: 道具 `tools/run-rpgunit.mjs` に IFS 方式のテストファイルを渡すと、IFS 方式で回り、VS Code と同じ判定になる
      （道具の実機 E2E に IFS 方式の正常・失敗を足す）。判定は共通部品で行う（前の work #181 で足した、道具の self-test が
      道具自身のソースを読んで独自実装を見張る検査を通る）。
- [ ] AC9: メンバー方式の挙動が変わらない（`npm test` 全件、`dev/rpgunit-e2e.mjs` の 12 項目、`tools/run-rpgunit-e2e.mjs` の 23 項目）。
- [ ] AC10: 展開先が決まらない・IFS に書けない・コンパイルできないとき、そのファイルのテストが errored になり、原因と次の手が
      メッセージに出る（単体テスト。展開先が決まらない場合は実機 E2E でも確かめる）。「展開先が決まらない」の条件は design で確定したものに従う。
- [ ] AC11: `testing.json` の `bndSrvPgm` / `bndDir` が IFS 方式でも効く（実機 E2E。サービスプログラムを呼ぶテストが合格する）。
- [ ] AC12: `tools/README.md`・skill `rpgunit-test`・`docs/workflow/rpgunit-test-explorer.md`（新規。VS Code 側の使い方）に、IFS 方式の置き方・方式の決まり方・名前の決め方・展開先と
      実行後に IFS に残るもの・文字コードの扱い・`/COPY` の書き方が書かれている。
- [ ] AC13: CI（`npm test`・`tools self-test`）が通る。
- [ ] AC14: `src/<LIB>/<SRCFILE>/` の下にある `*.test.rpgle` が、FR2 の規則どおりどちらか一方の方式だけで Test Explorer に出る（二重に出ない。単体テスト）。

## 未確定事項 / 確認したいこと（research・design で解消する）

- **文字コード**: 1208 が開けない原因（7.3 の `CRTRPGMOD` が UTF-8 のストリームをどう読むか・PTF・`TGTCCSID` の有無）と、
  取る手（展開時に EBCDIC/5035 へ変換して置く・タグを変える・ほかの手）。943 の重大度 40 の中身。
  IBM i Testing は `TGTCCSID(*JOB)` を既定にしている（7.3 の `CRTRPGMOD` に `TGTCCSID` が無いことは前の work で確認済み）。
- **展開のしかた**: Code for IBM i のデプロイ（ワークスペース全体・利用者が設定したデプロイ先）に乗るか、
  テストに要るファイルだけを送るか。デプロイ先が未設定のときの扱い。道具（hostserver）側の展開先。
- **方式の決まり方**: `*.test.rpgle` が `src/<LIB>/<SRCFILE>/` の下にもあった場合にどちらにするか。
- **テスト・プログラムの置き場**: IBM i Testing は現行ライブラリー（`&CURLIB`）と `getSystemNameFromPath`
  （`.test` を除き `T` を前置、10 文字に詰める）。これに揃えるか。
- **コピー句の解決**: `INCDIR` に何を入れるか（IBM i Testing はデプロイ先を必ず足す）。コピー句の文字コード（FR6）。
  `probe-srcstmf.mjs` の P2/P3（INCDIR の有無・同じディレクトリ）は文字コードの問題で判定まで届いていない。
