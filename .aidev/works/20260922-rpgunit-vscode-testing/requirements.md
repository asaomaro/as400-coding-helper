# 要件: RPGUnitテストのVS Code Test Explorer統合

## 背景 / 課題

- 現状、RPGUnitのテスト実行はコマンドライン（`tools/run-rpgunit.mjs`）やAIエージェント向けskill
  （`rpgunit-test`）経由でのみ行え、VS Code上で人間の開発者がテストツリーを見ながら実行・結果確認
  する手段がない。
- IBM公式「IBM i Testing」拡張（`IBM.vscode-ibmi-testing`）はテスト機能自体は充実しているが、
  `package.json` の `extensionDependencies` に `halcyontechltd.vscode-rpgle` が必須指定されている。
  本PJの `.rpgle` は既に独自の `rpg-fixed` languageId（`vscode-extension/package.json`）が登録済みで、
  同じ拡張子に対する言語登録の衝突が**実際に確認された**ため採用できない。
- 一方 Code for IBM i 拡張（`halcyontechltd.code-for-ibmi`）は IFS エクスプローラー・ジョブログ表示・
  コンパイルエラーのインライン表示など接続まわりの機能を既に持ち、`vscode-rpgle` を強制しない
  （拡張依存は `barrettotte.ibmi-languages` と walkthroughs のみ、確認済み）ため、再発明せず利用できる。

## 目的 / ゴール

- 人間の開発者がVS CodeのTest Explorer（Testing API）上でRPGUnitのテストスイート/テストケースを
  一覧・実行でき、成功/失敗がインラインで確認できる状態。
- 接続・IFS操作・ジョブログ・コンパイルエラー表示はCode for IBM iの機能を再利用し、
  本PJが独自の接続層を新たに持たない状態。

紐づく charter ゴール: IBM i 開発ワークフロー支援（第6の柱。本workの起票にあわせて `.aidev/charter.md`
に追加）

## ユーザーストーリー

- US1: VS Code拡張の利用者（人間の開発者）として、書いたRPGコード用のRPGUnitテストをTest Explorer
  上で一覧・実行したい。なぜなら、コマンドラインでのRUCALLTST実行やスプール読解の手間なく、
  エディタ上で素早くテスト結果を確認できるから。（受け入れ: AC1, AC2, AC3）
- US2: VS Code拡張の利用者として、テスト失敗時にどのアサーションで何が落ちたかをエディタ上で
  確認したい。なぜなら、失敗箇所の特定にスプール解読を要さず、即座に修正に着手できるから。
  （受け入れ: AC4）
- US3: （将来対応。今回のスコープ外。理由は「スコープ / 対象外」参照）VS Code拡張の利用者として、
  テスト実行結果のコードカバレッジをエディタ上で確認したい。なぜなら、どの行が未検証かを
  視覚的に把握し、テスト網羅の抜けに気づけるから。

## スコープ

### 対象

- Test Explorer（VS Code Testing API）向けの TestController 実装：ローカルワークスペースの
  RPGLEテストソースからRPGUnitテストスイート/テストケースを検出し、テストツリーとして表示する。
- テスト実行：Code for IBM iの接続を介してコンパイル（`RUCRTRPG` 等）・実行（`RUCALLTST`）を行い、
  結果（成功/失敗/エラー）をTest Explorerに反映する。
- 失敗時のインライン表示（失敗メッセージ・アサーション内容をエディタ/詳細パネルに表示）。
- 既存の「IBM i ソースメンバー同期」（第5の柱・work `20260910-ibmi-source-member-sync`）で
  ローカルワークスペースに対応付けられたテストソースを前提とする。

### 対象外

- スタブ（テスト雛形）の自動生成機能（将来のbacklog候補）。
- AIエージェント向けの新しい実行経路（VS Code操作MCP等）の新設。AIエージェントは引き続き既存の
  `rpgunit-test` skill / `tools/run-rpgunit.mjs`（ヘッドレス実行）を使用する。
- IBM i Testing拡張機能（`IBM.vscode-ibmi-testing`）の採用（言語登録衝突のため）。
- RPGUnitライブラリ自体のサーバー側導入・CI/インフラ整備（SR-OSAKAへは導入済み。charter既定の非ゴール）。
- Code for IBM iが未導入・未接続の場合のフォールバックUI（導入・接続済みを前提とする）。
- **コードカバレッジ（`CODECOV`）の取得・エディタへのオーバーレイ表示（test工程でAC5から降格・
  2026-09-22）**。実機確認（T1）でSR-OSAKAに`CODECOV`/5770WDSが未導入と確定し、本PJが検証に
  使える唯一の実機でコマンド構文・出力形式を確認する手段が無いことが判明した（decisions.md D3・D6）。
  検出ロジック（`isCodeCoverageAvailable`）のみ実装済みで、実行・結果解析は5770WDS導入環境が
  確保できたら別workで着手する。

## 機能要件

- FR1: ワークスペース内のRPGUnitテストソース（ローカルファイル）からテストスイート/テストケースを
  検出し、Testing APIのTestItemツリーとして構築する。
- FR2: Test Explorerからの実行操作（全体/スイート単位/ケース単位）で、Code for IBM iの接続を使って
  コンパイル・実行し、結果を取得する。
- FR3: `RUCALLTST` の実行結果（成功/失敗/エラー、失敗メッセージ、アサーション詳細）をTestItemの
  結果として反映する。
- FR4: コンパイルエラー発生時は、Code for IBM iの標準的なエラー表示機構（診断/問題パネル等）で
  確認できるようにする。

## 非機能要件 / 制約

- Code for IBM i拡張（接続済み）を前提とする。未接続時の詳細な振る舞いは対象外。
- 既存の `rpg-fixed` 言語登録・プロンプター・ルーラー・SOSI表示等の既存機能に副作用を与えない
  （languageId / activationEvents変更時は AGENTS.md の下流波及チェックに従う）。
- 既存の `tools/run-rpgunit.mjs` / `rpgunit-test` skill（AIエージェント向け）は変更しない。

## 完了条件 (受け入れ基準)

- [ ] AC1: ワークスペース内のRPGUnitテストソースを開くと、VS CodeのTest ExplorerパネルにTestItem
      ツリー（テストスイート/テストケース）として表示される。
- [ ] AC2: Test Explorerから個別テストケース・テストスイート・全体のいずれかを実行すると、
      Code for IBM iの接続を介してコンパイル・実行され、成功/失敗が反映される。
- [ ] AC3: 実行中/成功/失敗/エラーの各状態がTest Explorer上のアイコン・色で判別できる。
- [ ] AC4: テストが失敗した場合、失敗したアサーションの内容（期待値・実際値等）がインラインまたは
      詳細パネルで確認できる。
- [ ] AC6: 拡張機能導入後も既存のRPG言語機能（補完・ルーラー・プロンプター等）が従来通り動作する
      （回帰なし）。

## 相互作用の受け入れ基準（UI を伴う work）

- [ ] AC-I1 開く/閉じる: Test Explorerパネルはアクティビティバー/コマンドパレットから開閉でき、
      VS Code標準のTesting UIの挙動に従う。
- [ ] AC-I2 確定/取り消し: テスト実行はRunボタン/コマンドで開始し、実行中はキャンセル操作で中断できる。
- [ ] AC-I3 キーボードだけで完結するか: Test Explorerの標準操作（フォーカス移動・Enterで実行等）が
      キーボードのみで可能である。
- [ ] AC-I4 フォーカスの行き先: 失敗したテストの詳細を開いた際、該当するアサーション行にジャンプできる。
- [ ] AC-I5 既存の操作を妨げないか: RPGソース編集中の既存のキーバインド（タブナビゲーション等）を、
      テスト機能追加が妨げない。

## 未確定事項 / 確認したいこと

- コードカバレッジに必要な `CODECOV`（5770WDS）がSR-OSAKA（検証環境）に導入・PTF適用済みかは未確認。
  design/research工程で実機確認する。
- Code for IBM iの公開API（`@halcyontech/vscode-ibmi-types` 等）から接続情報・コマンド実行・
  IFSアクセスがどこまで取得できるかは未検証。research工程での調査を推奨。
- 既存の `tools/run-rpgunit.mjs` の実行・XML解析ロジックをどこまで再利用できるか（Code for IBM iの
  API経由に配線し直す必要があるか）は未検証。
- RPGUnitテストソースの検出条件（ファイル名規則・ソース物理ファイル規約等）は本PJでは未定義。
  design工程で定める。
