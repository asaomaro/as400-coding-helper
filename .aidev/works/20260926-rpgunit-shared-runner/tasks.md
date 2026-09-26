# タスク: RPGUnit の実行ロジックを VS Code と skill で共通にする

## 実装方針

先に共通部品（解析の拡張・`testing.json` の探し方・コンパイル〜実行の手順）を単体テスト付きで作り、VS Code 側を
それに載せ替えて既存のテストと実機 E2E で挙動が変わらないことを確かめる。そのあとで道具を載せ替え、道具の実機 E2E を足す。

## 作業順序と依存関係

下の `依存:` に従う。VS Code 側の載せ替え（T4）は、道具（T6）より先に済ませる——共通部品の形を、既に実機で
動いている側で先に確定させるため。

## リスク / 留意点

- 道具の出力（ビルド失敗時の表示）と `--bnd` の解釈が変わる。文書（T8）に書く。
- `testController.ts` の載せ替えで挙動を変えない（AC9）。既存の単体テストを先に通してから進める。

## テスト方針

- 共通部品・VS Code 側: `npm test`。追加テストは実装を外すと落ちることを確かめる。
- 道具: `vscode-extension/` で `npm run compile` してから `node tools/run-rpgunit.mjs --self-test`（道具自身のソースを読む見張りを含む）。
- 実機: `vscode-extension/dev/rpgunit-e2e.mjs`（12 項目・回帰）と新規 `tools/run-rpgunit-e2e.mjs`。
  修正前の道具で古い `*SRVPGM` を成功扱いすることも実機で確かめて記録する（AC2）。

## タスク

- [x] T1: `parseJUnitXml` に `assertions`・`time`（テストケース）と `properties`（スイート）を足す。単体テスト付き。
      対象: `vscode-extension/src/testing/resultParser.ts` `parseJUnitXml` / `vscode-extension/test/unit/resultParser.test.ts`
      依存: なし
      AC: AC8
- [x] T2: `testingConfigCore.ts` を作り、`resolveBinding` と型を移し、読み取りを注入する `findTestingConfigs` を足す。
      `testingConfig.ts` は `vscode.workspace.fs` で読む薄い層にする。単体テストを移し、上端・git でない場合・`.vscode`・
      キー単位の優先を確かめる。
      対象: 新規 `vscode-extension/src/testing/testingConfigCore.ts` / `vscode-extension/src/testing/testingConfig.ts` /
      `vscode-extension/test/unit/testingConfig.test.ts`
      依存: なし
      AC: AC3, AC6
- [x] T3: `suiteRunner.ts` を作る（`SuiteConnection`・`CommandResultLike`・`testLibraryList`・`compileSuite`・`runSuite`）。
      `codeForIbmi.ts` の `CommandResultLike` を移し、`IbmiTestingConnection` を `SuiteConnection` の拡張にする。単体テスト付き
      （コマンドの中身と順序、`code` による判定、実行前の XML 削除、`keepXml`、2 つの既定リスト）。
      対象: 新規 `vscode-extension/src/testing/suiteRunner.ts` / `vscode-extension/src/testing/codeForIbmi.ts` /
      新規 `vscode-extension/test/unit/suiteRunner.test.ts`
      依存: T1, T2
      AC: AC1, AC2, AC5, AC13
- [x] T4: `testController.ts` の `runFile` を `compileSuite`・`runSuite` の呼び出しに置き換える。既存の単体テストは**期待値を変えずに**
      通すこと（import 先の変更だけは許す。`testLibraryList` を `suiteRunner` から読むなど）。
      対象: `vscode-extension/src/testing/testController.ts` `runFile` / `vscode-extension/test/unit/testController.test.ts`
      依存: T3
      AC: AC1, AC9
- [x] T5: 共通部品のファイル（`rpgunitCommands.ts`・`resultParser.ts`・`testingConfigCore.ts`・`suiteRunner.ts`・
      `src/sync/memberTarget.ts`）が `vscode` を import しないことを見張る単体テストを足す。
      対象: 新規 `vscode-extension/test/unit/testingCore.test.ts`
      依存: T2, T3
      AC: AC7
- [x] T6: `tools/run-rpgunit.mjs` を共通部品に載せ替える。ビルド済みの共通部品を読み（無ければ終了コード 2）、hostserver の
      SQL ジョブ（`QCMDEXC`）と IFS で `SuiteConnection` を実装し、`testing.json`（上端は git の最上位）と `--bnd`（`bndSrvPgm` を置き換え）
      で `compileSuite`・`runSuite` を呼ぶ。独自の `summarize`・コマンド組み立て・`objectExists`・`waitJob`・`reportSpools` を消す。
      self-test を合わせ、道具自身のソースを読む見張り（AC7）を足す。
      対象: `tools/run-rpgunit.mjs`
      依存: T2, T3, T4
      AC: AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC13
- [x] T7: CI の `tools self-test` で、先に拡張機能をビルドする。
      対象: `.github/workflows/tools-tests.yml`
      依存: T6
      AC: AC11
- [x] T8: `tools/README.md` と skill `rpgunit-test` を更新する（`testing.json`・`--bnd` の解釈・`--keep` と実行前の XML 削除・
      ビルドの前提・ビルド失敗時の表示）。
      対象: `tools/README.md` / `.claude/skills/rpgunit-test/SKILL.md`
      依存: T6
      AC: AC12
- [x] T9: 2 つの実機 E2E が使うテストソースとテスト対象の作成を共有部品にし、道具の実機 E2E（`tools/run-rpgunit-e2e.mjs`）を足す
      （正常・古い `*SRVPGM`・`testing.json` のバインド・`--bnd`・誤った `testing.json`・`--check-independence`・`--rclrsc`・
      `--xml`・`--md`・`--json`・`--keep`、片付けと残存ゼロ）。
      対象: 新規 `vscode-extension/dev/rpgunit-e2e-fixtures.mjs` / `vscode-extension/dev/rpgunit-e2e.mjs` / 新規 `tools/run-rpgunit-e2e.mjs`
      依存: T6
      AC: AC2, AC3, AC4, AC6, AC8, AC10, AC13
- [x] T10: 回帰と対照の確認。`npm test` 全件、`dev/rpgunit-e2e.mjs` の 12 項目、道具の self-test、`tools/run-rpgunit-e2e.mjs`。
      修正前の道具（コミット済みの版）で古い `*SRVPGM` を成功扱いすることを実機で確かめる。
      対象: 未特定（各テスト・E2E の実行結果）
      依存: T4, T5, T7, T8, T9
      AC: AC2, AC9, AC11
