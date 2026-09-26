# 要件: RPGUnit テストにテスト対象のサービスプログラムをバインドする

## 背景 / 課題

RPGUnit の Test Explorer 統合（`20260922-rpgunit-vscode-testing`、PR #178・#179）は `RUCRTRPG` に
`BNDSRVPGM` / `BNDDIR` を渡していない。RPGUnit の想定は「テスト対象をテスト用サービスプログラムに
バインドし、その手続きを直接呼ぶ」（`.claude/skills/rpgunit-test/SKILL.md`「何を単位にするか」）なので、
**別のサービスプログラムにある業務ロジックを呼ぶテストが書けない**。実務の単体テストの大半が該当する。

AI エージェント向けの `tools/run-rpgunit.mjs` には `--bnd` があるが、VS Code 側には指定する場所が無い。

## 目的 / ゴール

VS Code の Test Explorer から、テスト対象のサービスプログラム（またはバインディング・ディレクトリ）に
バインドした RPGUnit テストを実行できる状態。そのバインドの設定を、IBM i Testing 拡張と同じファイルとして
両方の拡張で使える状態。

紐づく charter ゴール: IBM i 開発ワークフロー支援（第 6 の柱）

## ユーザーストーリー

- US1: RPG 開発者として、サービスプログラムの手続きを呼ぶ単体テストを Test Explorer から実行したい。
  なぜなら、業務ロジックはサービスプログラムにあり、それを直接検証できないと単体テストにならないから。
  （受け入れ: AC1, AC2, AC4, AC7）
- US2: IBM i Testing 拡張も使う（または将来移る）開発者として、バインドの指定を同じ `testing.json` に
  書きたい。なぜなら、設定を二重に持つと食い違い、移行のたびに書き直しになるから。
  （受け入れ: AC1, AC2, AC3, AC4, AC8）
- US3: 設定を書き間違えた開発者として、何が悪いかをテスト結果の中で知りたい。なぜなら、黙って無視されると
  バインドされていない理由を探すのに時間を失うから。（受け入れ: AC5）
- US4: `testing.json` を使わない（バインドの要らない）開発者として、これまでどおりテストを実行したい。
  なぜなら、この機能のために既存のテストの書き方や設定を変えたくないから。（受け入れ: AC6, AC9）

## スコープ

### 対象

- `testing.json` の `rpgunit.rucrtrpg.bndSrvPgm` / `bndDir` を読み、`RUCRTRPG` の `BNDSRVPGM` / `BNDDIR` に渡す。
- 探す場所は IBM i Testing と同じ: テストファイルのディレクトリから親へワークスペースフォルダーまで遡った
  最寄りの `testing.json` と、`<ワークスペース>/.vscode/testing.json`。

### 対象外

- `testing.json` のほかのキー（`cOption`・`dbgView`・`rucalltst` の各項目など）の反映。読んでも無視する。
- テストソースを IFS に展開してコンパイルする方式（backlog `workflow.md` に起票済み）。
- 実機上の `testing.json`（ソース物理ファイル・IFS 上に置くもの）の読み取り。ローカルのワークスペースだけ。
- `testing.json` の JSON Schema による入力補完（IBM i Testing が `jsonValidation` で提供している）。

## 機能要件

- FR1: テストを実行するとき、テストファイルごとに `testing.json` を探して読む。テストファイルがどの
  ワークスペースフォルダーにも属さないときは読まない（指定無しとして扱う）。
- FR2: `bndSrvPgm` は `BNDSRVPGM(...)`、`bndDir` は `BNDDIR(...)` として `RUCRTRPG` に渡す。空なら付けない。
- FR3: 合成は `bndSrvPgm` と `bndDir` の**キーごと**に行う。両方のファイルに同じキーがあれば最寄りの値を
  （配列ごと）採り、片方にしか無いキーはその値を採る。
- FR4: 修飾の無い名前は `*LIBL` で解決させる（ライブラリーを補わない）。名前は大文字にして渡す。
- FR5: 次のいずれかなら、そのテストファイルのテストを実行せず errored にし、原因の `testing.json` の
  パスと理由をメッセージに出す。検査は**合成の前に、見つかった各ファイルに対して**行う（最寄りの値で
  上書きされる `.vscode/testing.json` の値も検査する。壊れた設定を黙って残さないため）。
  名前は大文字・小文字を区別せず、大文字にしてから判定する。
  (a) JSON として読めない (b) `rpgunit`・`rpgunit.rucrtrpg` がオブジェクトでない、または
  `bndSrvPgm` / `bndDir` が文字列の配列でない
  (c) 要素が `NAME` か `LIB/NAME` の形でない。`NAME`・`LIB` は IBM i のオブジェクト名（英字・`$#@` で始まり、
  英数字・`$#@_.` が続く 10 文字以内）。`LIB` には `bndSrvPgm` なら `*LIBL`、`bndDir` なら
  `*LIBL`・`*CURLIB`・`*USRLIBL` も書ける (d) 件数が `RUCRTRPG` の上限（`bndSrvPgm` 50・`bndDir` 10）を超える。
  上限・特殊値は実機の `RPGUNIT/QCMD(RUCRTRPG)` のコマンド定義（2026-09-26 に直読）による。

## 非機能要件 / 制約

- IBM i Testing の `testing.json`（`IBM/vscode-ibmi-testing` の `schemas/testing.json`）と同じ書式で読めること。
- `testing.json` が無いワークスペースでは、これまでと挙動を変えない。
- 実機 E2E（`vscode-extension/dev/rpgunit-e2e.mjs`）で、バインドが効いていることを実物で確かめる
  （`20260922-rpgunit-vscode-testing` の D8: 外部拡張・実機に乗る機能はスタブの緑で完了にしない）。

## 完了条件 (受け入れ基準)

- [ ] AC1: `rpgunit.rucrtrpg.bndSrvPgm` が `RUCRTRPG` の `BNDSRVPGM` に渡る。置き場所がテストファイルと
      同じディレクトリでも、ワークスペースフォルダー内の親ディレクトリでも、`.vscode/testing.json` だけでも渡る。
      ワークスペースフォルダーの外にある `testing.json` は読まない。テストファイルごとに最寄りを探し、
      別の `testing.json` を持つほかのテストファイルの値は混ざらない。
- [ ] AC2: 同じ置き場所の規則で、`bndDir` が `BNDDIR` に渡る。
- [ ] AC3: 最寄りの `testing.json` と `.vscode/testing.json` に同じキーがあると最寄りの値（配列ごと）が使われ、
      片方にしか無いキーはその値が使われる（例: 最寄りに `bndSrvPgm`、`.vscode` に `bndDir` なら両方渡る）。
- [ ] AC4: `LIB/NAME` はそのまま、`NAME` は修飾せずに渡る（`*LIBL` で解決される）。小文字で書いても大文字で渡る。
- [ ] AC5: FR5 の (a)〜(d) のいずれでも、そのテストファイルのテストが errored になり（コンパイルしない）、
      メッセージに原因の `testing.json` のパスと理由が出る。その `testing.json` を使わないほかのテストファイルは
      影響を受けない。
- [ ] AC6: `testing.json` が無ければ、これまでと同じコマンドでコンパイルされる（回帰なし）。
- [ ] AC7: 実機 E2E で、別のサービスプログラムの手続きを呼ぶテストが、`testing.json` 無しでは Errored、
      `bndSrvPgm` 指定では Passed、`bndDir` 指定では Passed になる。
- [ ] AC8: IBM i Testing の `testing.json` にあるほかのキーが含まれていても、エラーにせず動く。
- [ ] AC9: `bndSrvPgm` / `bndDir` が空配列、またはキーが無いときは、`BNDSRVPGM` / `BNDDIR` を付けない。

## 未確定事項 / 確認したいこと

- IBM i 7.3 ＋ iRPGUnit v6.0.2.r の `RUCRTRPG` で `BNDDIR` が期待どおり効くか（AC7 の実機 E2E で確かめる）。
  **効かなければ `bndDir` はこの work の対象から外し**（壊れたまま出さない）、理由を decisions.md に残して
  requirements を差し戻す。
