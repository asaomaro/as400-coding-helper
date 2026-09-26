# タスク: RPGUnitテストのVS Code Test Explorer統合

## 実装方針

design.mdの依存性注入方針に沿い、**純粋ロジック（検出・コマンド構築・XML解析）を先に単体で
作り、そのあとに接続adapterとTestController配線でつなぐ**順序で進める。実機確認が要る
未確定事項（decisions.md D2, D3）は最初に片付け、後続タスクの実装方針をそれに合わせる。

## 作業順序と依存関係

- T1（実機確認）を最初に行う。ここで判明した事実（`RUCRTRPG`のタイムアウト挙動、
  `CODECOV`のSR-OSAKA導入有無、IFS一時ファイル削除API、ソース行ジャンプ精度）が
  T5・T6・T7の実装詳細を左右するため、これらより先に完了させる。
- T2・T3・T4（純粋ロジック）はT1と並行して着手できる（接続層に依存しないため）。
- 依存関係の詳細は下の各タスクの `依存:` に従う。

## リスク / 留意点

- T1でCODECOVがSR-OSAKAに未導入と判明した場合、T6は「検出したら無効化する」実装
  （decisions.md D3）で完了とし、実機での動作確認は別途CODECOV導入後に持ち越す
  （`decisions.md`に追記する）。
- T1で`RUCRTRPG`が同期`runCommand`のタイムアウトに収まらないと判明した場合、
  T5の実装をSBMJOB＋ポーリング方式に変更する（decisions.md D2のフォールバック）。

## テスト方針

- 純粋ロジック（T2, T3, T4）は`vscode`をスタブ化せずに素のNode.jsユニットテストで検証する
  （AGENTS.mdの規約：`vscode` APIはスタブで差し替える。実機に触らない部分は`--self-test`
  相当の対照値で検証する。`tools/run-rpgunit.mjs`の`--self-test`と同型のテストデータを流用する）。
- T5・T6・T7（VS Code/接続I/O）は`test/support/vscode-stub.js`を差し替えて
  extension hostを起動せずに検証する（既存の`memberSync.test.ts`と同じパターン）。
- test工程で`npm test`を実行し、既存テスト（プロンプター・ルーラー等）が回帰していないことを
  確認する（AC6）。

## タスク

- [x] T1: 実機確認スパイク（`ibmi-remote` skill経由でSR-OSAKAに接続し、以下4点を確認する）
      1) `RUCRTRPG`の所要時間とCode for IBM iの`runCommand`/`sendCommand`相当の
      タイムアウト有無（decisions.md D2）。2) `CODECOV`コマンド・`5770WDS`・PTFの
      導入有無（decisions.md D3、research.md F13）。3) IFS一時ファイルの削除API
      （`RemoveLink`相当。design.md「振る舞いの詳細」2.f）。4) `OPTION(*SRCSTMT)`付き
      コンパイルでの失敗報告行番号とソース行の対応精度（design.md「design への申し送り」）。
      確認結果を`decisions.md`に追記する。
      対象: 未特定
      依存: なし
      AC: なし

- [x] T2: `resultParser.ts` — JUnit形式XML解析ロジックを移植する（純粋関数、単体テスト付き）。
      `tools/run-rpgunit.mjs`の`summarize`と同じ入出力（v4/v6両形式、CDATA・エンティティの
      アンエスケープ）をTypeScriptで再実装する。
      対象: `tools/run-rpgunit.mjs:158-188`（移植元） → 新規
      `vscode-extension/src/testing/resultParser.ts` / 根拠: design.md インターフェース節、
      research F14
      依存: なし
      AC: AC4

- [x] T3: `rpgunitCommands.ts` — `RUCRTRPG`/`RUCALLTST`コマンド文字列構築ロジックを移植する
      （純粋関数、単体テスト付き）。`TGTCCSID(0)`、`SRCMBR`=プログラム名一致の制約を含む。
      対象: `tools/run-rpgunit.mjs:467-520`（移植元） → 新規
      `vscode-extension/src/testing/rpgunitCommands.ts` / 根拠: design.md インターフェース節、
      research F15, F16
      依存: なし
      AC: AC2, AC4

- [x] T4: `discovery.ts` — テスト検出ロジック（`findTestProcedures` / `discoverTestFiles`）を
      実装する（純粋関数、単体テスト付き）。`tools/run-rpgunit.mjs`の`parseOracleMarkers`の
      手続き列挙部分（固定長P仕様・自由形式・継続名前行）を参考にする。
      対象: `tools/run-rpgunit.mjs:217-259`（参考） /
      `vscode-extension/src/sync/memberTarget.ts`（`resolveMemberTarget`を再利用） → 新規
      `vscode-extension/src/testing/discovery.ts` / 根拠: design.md インターフェース節、
      research F17
      依存: なし
      AC: AC1

- [x] T5: `codeForIbmi.ts` — Code for IBM i拡張のソフト検出・接続adapterを実装する。
      T1の実機確認結果（タイムアウト挙動）を踏まえ、同期`runCommand`かSBMJOB方式かを
      確定する。`@halcyontech/vscode-ibmi-types`を開発依存に追加して型を確認しながら
      実装する。
      対象: 新規 `vscode-extension/src/testing/codeForIbmi.ts` / 根拠: design.md
      インターフェース節（`IbmiTestingConnection`/`connectViaCodeForIbmi`）、
      research F5-F8a, decisions.md D1, D2
      依存: T1
      AC: AC2

- [x] T6: `coverage.ts` — `CODECOV`検出・実行・カバレッジ結果の`FileCoverage`変換を実装する。
      T1でCODECOV未導入と判明した場合は検出ロジックのみ実装し（`checkObjectExists`で
      false判定→Coverage profile非登録）、実行・解析部分は実機確認できた範囲で実装する。
      対象: 新規 `vscode-extension/src/testing/coverage.ts` / 根拠: design.md「コードカバレッジ
      実行」節、decisions.md D3
      依存: T1, T3, T5
      AC: なし

- [x] T7: `testController.ts` — `vscode.TestController`の生成、`resolveHandler`での
      テストツリー構築、`runHandler`（Run/Coverageプロファイル）、エラー処理
      （未導入/未接続/API不一致/コンパイル失敗/実行失敗）を実装する。
      対象: 新規 `vscode-extension/src/testing/testController.ts` / 根拠: design.md
      インターフェース節（`registerRpgUnitTesting`）、design.md「振る舞いの詳細」
      （シーケンス図含む）、design.md「エラー処理 / 異常系」表
      依存: T2, T3, T4, T5, T6
      AC: AC1, AC2, AC3, AC4, AC-I1, AC-I2, AC-I3, AC-I4

- [x] T8: `extension.ts`への配線 — activation時に`registerRpgUnitTesting(context)`を
      呼び出す。
      対象: `vscode-extension/src/extension/extension.ts:8-24` / 根拠: design.md
      「依拠する既存の事実」、research A1
      依存: T7
      AC: なし

- [x] T9: 既存機能への回帰確認と相互作用要件の妨げ無し確認。`npm test`で既存の
      プロンプター・ルーラー・SOSI表示等のunit testが通ることを確認し、
      新規追加したキーバインド・コマンドが無い（package.json差分で確認）ことを確かめる。
      対象: 未特定（既存 `test/unit` 配下の実行結果）
      依存: T8
      AC: AC6, AC-I5

### deliver 後の追加（実機 E2E で見つかった欠陥・2026-09-26。decisions.md D8）

- [x] T10: `RUCRTRPG`/`RUCALLTST` を `RPGUNIT`・対象ライブラリー・利用者のライブラリー・リストの順で
      実行する（Code for IBM i の `runCommand` の `env` の `&LIBL`）。無いと `CPF4102` で全件落ちる。
      対象: `vscode-extension/src/testing/codeForIbmi.ts` `wrapConnection` /
      `vscode-extension/src/testing/testController.ts` `runFile` `testLibraryList`
      依存: T9
      AC: AC2
- [x] T11: コンパイルの成否を `*SRVPGM` の有無ではなく `RUCRTRPG` の結果（`code`）で判定する。
      前回の `*SRVPGM` が残っているとコンパイル失敗を成功と取り違え、古いテストを走らせていた。
      対象: `vscode-extension/src/testing/testController.ts` `runFile`
      依存: T9
      AC: AC2, AC4
- [x] T12: 開いているエディターの未保存の内容を送る。ファイル単位の例外で run が終わらず
      「実行中」のまま残らないよう、例外を errored にして受け止める。
      対象: `vscode-extension/src/testing/testController.ts` `readSourceText` `runHandler`
      依存: T9
      AC: AC2, AC3
- [x] T13: 本物の VS Code・Code for IBM i・実機で確かめる e2e（`dev/rpgunit-e2e.mjs`）を追加する。
      対象: `vscode-extension/dev/rpgunit-e2e.mjs`（新規） / `vscode-extension/dev/rpgunit-e2e-helper/`（新規）
      依存: T10, T11, T12
      AC: AC1, AC2, AC3, AC4, AC6, AC-I4
