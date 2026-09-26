# タスク: RPGUnit のテストを IFS に展開してコンパイル・実行できるようにする

## 実装方針

共通部品（名前の規則・コマンド・変換してコンパイルする手順）を単体テスト付きで先に作り、次に VS Code 側（接続のデプロイ・検出・
Test Explorer）、道具の順に載せる。実機 E2E は VS Code・道具とも、E2E 部品（テストソース）を共有して足す。メンバー方式の経路は
`runSuite` の入力の形を除いて触らない。
`AC:` には、その AC を**確かめる**タスクと、AC の仕組みを**実装する**タスクの両方を載せる（E2E で確かめる AC も、下支えする実装タスクに載せる）。

## 作業順序と依存関係

`依存:` 行が正典。共通部品（T1〜T3）→ VS Code（T4〜T6）・道具（T7）→ E2E（T8・T9）→ 文書（T10）→ 回帰（T11）。

## リスク / 留意点

- `runSuite` の入力の形を変える（`MemberTarget` → `TestProgram`）。呼び出し 3 か所（testController・道具・単体テスト）の書き換えだけで、
  既存テストの期待値は変えない（AC9）。
- VS Code の `GlobPattern` の `[tT]` が実物で効くかは実機 E2E（T8）で初めて分かる（design「検出」）。
- 実機 E2E はデプロイ先・一時ディレクトリ・作ったオブジェクトを必ず片付けて残存ゼロを数える。スプールは消さない。

## テスト方針

- 共通部品と VS Code 側は `npm test`。足したテストは実装を外すと落ちることを確かめる（AGENTS.md）。
- 道具は `node tools/run-rpgunit.mjs --self-test`（引数の解決・見張り）。
- 実機: `vscode-extension/dev/rpgunit-e2e.mjs`（既存 12 項目＋IFS 方式）と `tools/run-rpgunit-e2e.mjs`（既存 23 項目＋IFS 方式）。

## タスク

- [x] T1: 共通部品 `streamTarget.ts` を作る（`STREAM_TEST_SUFFIXES`・`isStreamTestFile`・`streamTestProgramName`・`resolveStreamTestTarget`）。
      `memberTarget.ts` のオブジェクト名の検査を `isIbmiObjectName` として公開し、名前の検査に使う。単体テスト（IBM i Testing と同じ入出力・
      不正な名前・大文字の接尾辞・`.sqlrpgle`）。`testingCore.test.ts` の見張りの対象に `streamTarget.ts` を足す。
      対象: 新規 `vscode-extension/src/testing/streamTarget.ts` / `vscode-extension/src/sync/memberTarget.ts:21` `IBM_I_OBJECT_NAME` /
      新規 `vscode-extension/test/unit/streamTarget.test.ts` / `vscode-extension/test/unit/testingCore.test.ts` `CORE_FILES`（research F9・F16）
      依存: なし
      AC: AC7
- [x] T2: `rpgunitCommands.ts` に `buildCreateStreamTestCommand` と `quoteClString` を足す（`SRCSTMF`・`INCDIR` 複数・バインド・`TGTCCSID(0)`）。単体テスト。
      対象: `vscode-extension/src/testing/rpgunitCommands.ts:38` `buildCreateTestCommand` の隣（research A5） / `vscode-extension/test/unit/rpgunitCommands.test.ts`
      依存: なし
      AC: AC3, AC6
- [x] T3: `suiteRunner.ts` に `compileStreamSuite`（`CPY TOCCSID(*JOBCCSID) DTAFMT(*TEXT)` → `RUCRTRPG` → 写しの `RMVLNK`、`stage` 付きの失敗）を足し、
      `runSuite` の入力を `TestProgram` にする。呼び出し（`testController.ts`・`tools/run-rpgunit.mjs`・`suiteRunner.test.ts`）を書き換える。
      単体テスト（コマンドの中身と順序・`INCDIR` の 2 つと重複・変換失敗・コンパイル失敗・`RMVLNK` の失敗を無視・`keepCopy`）。
      対象: `vscode-extension/src/testing/suiteRunner.ts:43` `compileSuite` の隣 / `:75` `runSuite`（research A4） / `vscode-extension/test/unit/suiteRunner.test.ts` /
      呼び出し `vscode-extension/src/testing/testController.ts:101` / `tools/run-rpgunit.mjs:474` 付近（`runSuite` の 2 か所）
      依存: T1, T2
      AC: AC2, AC3, AC4, AC9, AC10
- [x] T4: Code for IBM i の接続に `currentLibrary` と `deploy(folder)`（`exports.deployTools`・方法の選び方・未設定では `launchDeploy` を呼ばない・例外は failed）を足す。
      単体テスト（design AC10 の `codeForIbmi.test.ts` の項目）。
      対象: `vscode-extension/src/testing/codeForIbmi.ts:26` `RawIbmiConnection` / `:59` `wrapConnection` / `:142` `connectViaCodeForIbmi`（research A6） /
      `vscode-extension/test/unit/codeForIbmi.test.ts`
      依存: なし
      AC: AC7, AC10
- [x] T5: 検出に IFS 方式を足す（判別共用体・glob・`isStreamTestFile` で最終判定・URI の重複除去）。単体テスト（`src/` の外・メンバー方式と同時・
      `.sqlrpgle`・大文字・`src/L/F/x.test.rpgle` は IFS 方式だけ・`src/L/F/X.rpgle` はメンバー方式だけ・既存の期待値は不変）。
      対象: `vscode-extension/src/testing/discovery.ts:71` `buildDiscoveredTestFile` / `:93` `discoverTestFiles`（research A1） / `vscode-extension/test/unit/discovery.test.ts`
      依存: T1
      AC: AC1, AC9, AC14
- [x] T6: Test Explorer に IFS 方式の項目（ラベル・description）と実行（フォルダーごとに 1 回デプロイ → `compileStreamSuite` → `runSuite`、
      各失敗の errored とメッセージ、変換失敗の案内）を足す。**IFS 方式では `readSourceText`（未保存の内容）を使わない**（デプロイがディスクの
      ファイルを送るため。design「実行（VS Code）」）。単体テスト（ライブラリーが現行ライブラリー・各失敗・メンバー方式と混在した実行）。
      対象: `vscode-extension/src/testing/testController.ts:73` `runFile` / `:125` `runHandler` / `:182` `refresh`（research A2・A3） /
      `vscode-extension/test/unit/testController.test.ts`
      依存: T3, T4, T5
      AC: AC1, AC2, AC7, AC9, AC10, AC11
- [x] T7: 道具に IFS 方式を足す（ファイル名で判定・名前の既定・RPG ソースの送信と片付け・`compileStreamSuite`）。変換失敗・コンパイル失敗・送信失敗は
      終了コード 2 とメッセージ（design のエラー処理表。送信失敗は D12 のとおり単体テストはせず review でコードを読む）。self-test（名前の既定・作れない名前で
      終了コード 2・送るファイルの選び方の純粋な部分）。見張り（A9）を通す。
      対象: `tools/run-rpgunit.mjs:109` `parseArgs` / `:168` `findSearchRoot` / `:382` `openSuiteConnection` / `:474` `target`（research A7・A9）
      依存: T3
      AC: AC8, AC10
- [x] T8: E2E 部品に `japaneseSource`・コピー句を足し、VS Code の実機 E2E に IFS 方式のシナリオ（デプロイ先未設定・正常＋メンバー方式と同時・日本語・
      コピー句と対照・`IFSBIND.TEST.RPGLE` のバインド）を足す。ヘルパー拡張に `E2E_DEPLOY_DIR` によるデプロイ先の設定と解除を足す。片付けて残存ゼロ。
      対象: `vscode-extension/dev/rpgunit-e2e-fixtures.mjs` / `vscode-extension/dev/rpgunit-e2e.mjs:98` `runScenario` /
      `vscode-extension/dev/rpgunit-e2e-helper/extension.js`（research A8・A10）
      依存: T6
      AC: AC1, AC2, AC3, AC4, AC6, AC10, AC11
- [x] T9: 道具の実機 E2E に IFS 方式（正常＝終了コード 1・日本語、コピー句で合格＝0）と AC5 の対照（`--keep` で残した 1208 のソースを直接 `RUCRTRPG` → `CPE3490`）を足す。
      片付けて残存ゼロ。
      対象: `tools/run-rpgunit-e2e.mjs`（research A8）
      依存: T7, T8
      AC: AC5, AC8
- [x] T10: 文書。`tools/README.md`・skill `rpgunit-test`・新規 `docs/workflow/rpgunit-test-explorer.md`（design AC12 の項目、AC7 の名前とライブラリーの規則、
      IFS 方式は未保存の内容ではなくデプロイしたファイルを使うこと）。
      対象: `tools/README.md` / `.claude/skills/rpgunit-test/SKILL.md` / 新規 `docs/workflow/rpgunit-test-explorer.md`
      依存: T6, T7, T8
      AC: AC7, AC12
- [ ] T11: 回帰と CI。`npm test` 全件、`dev/rpgunit-e2e.mjs`（既存 12 項目＋追加）、道具の self-test、`tools/run-rpgunit-e2e.mjs`（既存 23 項目＋追加）、PR の CI。
      消化は test 工程と deliver（CI）（decisions D13）。
      対象: 未特定（各テスト・E2E・CI の実行結果）
      依存: T8, T9, T10
      AC: AC9, AC13
