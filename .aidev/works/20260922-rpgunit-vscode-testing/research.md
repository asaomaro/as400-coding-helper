# 調査: RPGUnitテストのVS Code Test Explorer統合

## 調査の問い

- Q1: VS Code Testing API（TestController・Coverage API）は本PJの対象VS Codeバージョン
      （`engines.vscode: ^1.90.0`）で使えるか。
- Q2: Code for IBM i拡張の公開APIから何が取得できるか（接続・コマンド実行・ファイルI/O・ジョブログ）。
- Q3: CODECOVコマンドの使い方・ライセンス要件は何か。SR-OSAKAに導入されているか。
- Q4: 既存の `tools/run-rpgunit.mjs` のロジックはどこまで移植・再利用できるか。
- Q5: 既存の「IBM i ソースメンバー同期」（第5の柱）のローカル↔IBM i対応解決ロジックはテスト
      検出に転用できるか。
- Q6: Code for IBM iへの依存はどう統合するのが既存PJの方針（ソフト検出）と整合するか。

## 判明した事実

### VS Code Testing API（Q1）

- F1: `vscode.tests.createTestController` / `TestRunProfileKind`（`Run` と `Coverage`）/
      `FileCoverage` / `TestCoverageCount` / `TestRunProfile.loadDetailedCoverage` は、
      本PJが実際に依存している `@types/vscode@^1.90.0` の型定義に**存在することを直接確認した**
      （`vscode-extension/node_modules/@types/vscode/index.d.ts:18191,18197,18319,18394,18635,18894,18914`）。
      よって Coverage API を含め、`engines.vscode` の引き上げは不要。
- F2: 最小セットアップは `createTestController` → `TestItem` 作成 → `TestRun` を返す
      `runHandler` を持つ `TestRunProfile` の登録、という流れ（VS Code公式ガイド
      https://code.visualstudio.com/api/extension-guides/testing）。
- F3: 失敗箇所へのジャンプは `TestMessage.location`（`vscode.Location`）に失敗行の
      `Range` を設定して `run.failed(test, message)` する（同ガイド）。
- F4: Coverage は `TestRunProfileKind.Coverage` の専用 `runHandler` を持ち、
      `run.addCoverage(new vscode.FileCoverage(uri, statementCoverage))` でファイル単位の
      サマリを登録し、詳細（行単位）は `loadDetailedCoverage` で遅延ロードする（同ガイド）。

### Code for IBM i の公開API（Q2, Q6）

- F5: 拡張の検出・取得は `vscode.extensions.getExtension('halcyontechltd.code-for-ibmi').exports`
      から `instance` を取り出す形（公式 https://codefori.github.io/docs/dev/api/）。これは
      本PJの `20260910-ibmi-source-member-sync` の `decisions.md` D1（後に撤回）が採用しかけた
      パターンと一致する（`.aidev/works/20260910-ibmi-source-member-sync/decisions.md:6`）。
- F6: `instance.getConnection()` が返す `IBMi` クラス（`codefori/vscode-ibmi` の
      `src/api/IBMi.ts`、GitHub原文確認）は次を持つ:
      `runCommand(data): Promise<CommandResult>`（ILE/QSH/PASEコマンド実行）、
      `sendCommand(options): Promise<CommandResult>`（戻り値 `{code, stdout, stderr, signal?}`）、
      `sendQsh(options)`、`runSQL(statements): Promise<Tools.DB2Row[]>`、
      `getConfig(): ConnectionConfig`、`getTempDirectory()` / `getTempRemote(key)`、
      `getComponent<T>()`、`connect()` / `disconnect()`。
- F7: ジョブログ取得の専用APIは無い。`runSQL()` で `QSYS2.JOBLOG_INFO('*')` を問い合わせる形になる
      （公式ドキュメント記載のSQL例）。
- F8: IFS/ソースメンバーへのアクセスは `vscode.workspace.openTextDocument()` に
      `streamfile://` / `member://` スキームのURIを渡す、FileSystemProvider経由の形が
      公式Examplesに載っている（https://codefori.github.io/docs/dev/examples/）。
      これはドキュメント/エディタとして開く形であり、`tools/run-rpgunit.mjs` が使う
      「バイト列を直接read/write」する形とは性質が異なる。
- **未確認 F8a**: プログラムから直接バイト列を読み書きする content API
      （`content.uploadFile` 相当）の正確なシグネチャは今回のドキュメント調査では
      特定できなかった。design工程で `codefori/vscode-ibmi` の `src/api/` を直接読んで
      確認する必要がある。
- **未確認 F6a**: 上記API形状がCode for IBM iのどのバージョンから安定しているかは
      未確認（ドキュメントに明記が無い）。

### CODECOV / 5770WDS（Q3）

- F9: コマンド構文は `CODECOV CMD(<起動コマンド>) MODULE((<lib>/<pgm> *PGM *ALL))` の形
      （IT Jungle記事 https://www.itjungle.com/2019/11/25/guru-code-coverage-via-cl-command/ ）。
      主要パラメータ: `CMD`（必須）/ `MODULE`（対象、必須）/ カバレッジビュー（既定 `*DFT`）/
      収集レベル（`*LINE` または `*PROC`）/ 出力ディレクトリ。
- F10: 対象は `DBGVIEW(*SOURCE)` / `*LIST` / `*ALL` のいずれかでコンパイル済みである必要がある
      （同記事の要約。**原典PDFはIBM公式だが画像/バイナリ構成でWebFetchでは生テキストを
      抽出できず、二次情報にとどまる**）。
- F11: PTF要件（7.4未満）: V7.3は `SI65229` / `SI64655`、V7.2は `SI65228` / `SI64544`。
      V7.4は5770WDS option 60に含まれる（同記事）。コマンドは `QGPL` または `QDEVTOOLS` に入る。
- F12: 出力は `.cczip` ファイルで、RDiのCode Coverage Resultsビューでのインポートを
      前提にしている（同記事）。**VS Code側からプログラムで読める形式・APIかどうかは
      未確認**。IBM i Testing拡張（`IBM/vscode-ibmi-testing`、Apache-2.0）は実際に
      CODECOVを呼び出しVS CodeのCoverage APIへ橋渡ししている実装を持つはずで、
      設計時にその実装パターン（コードの流用ではなく方式の参考）を読むことを推奨する。
- **未確認 F13**: SR-OSAKA（検証環境）に5770WDS・該当PTFが導入済みかどうかは、
      今回のresearch工程では確認していない。この開発環境に `AS400_SYSTEM` 等の接続用
      環境変数が設定されておらず、`tools/run-rpgunit.mjs` の接続経路（ts5250/hostserver）
      を使った実機確認ができなかった。**design工程またはcoding工程の早い段階で、
      実機に接続できる環境から確認する（`ibmi-remote` skillの手順を使う）。**

### 既存資産の再利用可能性（Q4, Q5）

- F14: `tools/run-rpgunit.mjs` の `summarize(xml)`（`tools/run-rpgunit.mjs:158-188`）は
      JUnit形式XML（iRPGUnit v4/v6両対応、CDATA・エンティティのアンエスケープを含む）を
      純粋関数として解析しており、接続層に依存しないため**そのままTypeScript移植可能**。
- F15: 同ファイルのコンパイル・実行コマンド構築ロジック（`RUCRTRPG … TGTCCSID(0)` /
      `RUCALLTST … XMLSTMF(...)`、`tools/run-rpgunit.mjs:467-520`）は、
      Code for IBM iの `runCommand`/`sendCommand`経由に差し替えても**コマンド文字列の
      組み立てパターンはそのまま使える**（実行トランスポートだけ差し替える）。
- F16: `SRCMBR` はテストプログラム名と一致させる必要がある制約（`getMemberType` が
      プログラム名でメンバーを探すため。実機確認済み、`.claude/skills/rpgunit-test/SKILL.md:291-303`）は、
      テスト検出・実行ロジックの設計に必ず反映する必要がある。
- F17: `vscode-extension/src/sync/memberTarget.ts` の `resolveMemberTarget` は、
      ワークスペース相対パス `src/<LIB>/<SRCFILE>/<MEMBER>.<ext>` からIBM iの
      ライブラリー/ソース物理ファイル/メンバー名を解決する純粋ロジックを既に持つ
      （`vscode-extension/src/sync/memberTarget.ts:1-19`）。テストソースも同じ配置規約に
      従うなら、この関数をテスト検出（ローカルファイル→IBM i上の修飾名の対応）に
      **そのまま再利用できる**。
- F18: `vscode-extension/src/extension/extension.ts:8-24` が拡張のactivationの単一の入口で、
      既存の `registerMemberSyncCommands(context)` 等と並べて
      `registerRpgUnitTesting(context)` を追加するだけで到達可能になる。

## 影響範囲

- `vscode-extension/src/extension/extension.ts`（activation登録の追加）
- `vscode-extension/package.json`（`engines.vscode` は変更不要。設定項目・必要なら
  コマンドの追加。Testing APIの標準UI＝Test Explorerパネル自体は追加のcontributes不要）
- 新規モジュール（例 `vscode-extension/src/testing/`）: TestController実装、
  Code for IBM i検出・接続adapter、コンパイル/実行コマンド構築、XML結果解析
  （`tools/run-rpgunit.mjs` の該当ロジックの移植）
- `vscode-extension/src/sync/memberTarget.ts`（変更不要、参照のみ）
- 既存の `tools/run-rpgunit.mjs` / `.claude/skills/rpgunit-test`（AIエージェント向け。
  変更しない。ロジックの「参照元」としてのみ扱う）

## 実現性 / リスク

- **実現性は高い**: VS Code Testing API（Coverage含む）は現在の`engines.vscode`で
  問題なく使える（F1で確認済み）。Code for IBM iのコマンド実行API（`runCommand`/
  `sendCommand`/`runSQL`）も存在が確認できており、コンパイル・テスト実行の基本フローは
  組める見込み。
- **リスク1（content API未確認・F8a）**: ファイル転送（テストソースのアップロード、
  XML結果のダウンロード）に使う正確なAPIが未確認。設計前に一次ソース
  （`codefori/vscode-ibmi` の `src/api/`）を直接読んで確定する必要がある。
  最悪の場合、`runCommand`経由で `CPYFRMSTMF`/`CPYTOSTMF` を自前で組む形（
  `tools/run-rpgunit.mjs` と同型のアプローチ）に倒すことになる。
- **リスク2（CODECOVの実機可用性・F13）**: SR-OSAKAに5770WDS・PTFが導入されているか
  未確認。**未導入ならコードカバレッジ(FR5)はこのworkのスコープから外すか、
  導入作業を別タスクにするかをdesignで判断する必要がある。**
- **リスク3（.cczip解析・F12）**: CODECOVの出力形式をVS CodeのCoverage APIへ
  橋渡しする実装パターンが未確立。IBM i Testing拡張（Apache-2.0）のソースを
  参考にする前提を置くが、実装コストは他の要素より不確実性が高い。

## 実装アンカー

- A1: 拡張activationへの登録口（`vscode-extension/src/extension/extension.ts:8-24`）—
      `registerRpgUnitTesting(context)` をここに追加する。
- A2: ローカル↔IBM i対応解決（`vscode-extension/src/sync/memberTarget.ts` の
      `resolveMemberTarget`）— テスト検出時の修飾名解決に再利用する。
- A3: 対象拡張子の単一の真実源（`vscode-extension/src/utils/fileScope.ts:47-52,109-118`）—
      テストソースの対象拡張子（`.rpgle`/`.sqlrpgle` 想定）の扱いを検討する際に参照する。
      ただしテスト検出は「拡張子」だけでなく「RPGUnitのテスト規約（`test`始まりの
      `EXPORT`手続きを持つNOMAINサービスプログラム）」でも絞り込みが要る（未特定 — design/coding
      で具体的な検出条件を決める）。
- A4: XML結果解析ロジック（`tools/run-rpgunit.mjs:158-188` の `summarize`）—
      TypeScriptへの移植元。
- A5: コンパイル・実行コマンド構築とその罠（`tools/run-rpgunit.mjs:467-520`、
      `.claude/skills/rpgunit-test/SKILL.md:291-303,516-529`）— 実行トランスポートを
      Code for IBM iのAPIに差し替えつつ、コマンド文字列の組み立てパターン・罠の回避は
      踏襲する。
- A6（未特定）: Code for IBM iのcontent API（ファイル直接アップロード/ダウンロード）の
      正確なメソッド名・シグネチャ。design工程の着手前に `codefori/vscode-ibmi` の
      `src/api/` を直接読んで特定する。
- A7（未特定）: CODECOVの `.cczip` 出力をVS Code Coverage APIへ変換する実装。
      IBM i Testing拡張（`IBM/vscode-ibmi-testing`、Apache-2.0）のソースを参考にする。

## 実装時の注意

- **`SRCMBR` はテストプログラム名と一致させる**（別名だと `CPF9815`。F16参照）。
- **`RUCRTRPG` は `TGTCCSID(0)` が必要**（v5以降、IBM i 7.3の`CRTRPGMOD`に
  `TGTCCSID`キーワードが無いため。v4には元々`TGTCCSID`パラメータが無い）。
- **XMLのCCSIDはLatin-1（819）**。日本語のfailメッセージは失われる
  （`docs/workflow/rpgunit-install.md:213-231`）。テスト結果表示の文言はASCII前提で設計する。
- **バッチ実行（`SBMJOB`）では `INQMSGRPY(*DFT)` が必須**（無いと監視漏れの例外が
  照会メッセージになりジョブが`MSGW`で残る）。Code for IBM i経由でコマンドを実行する
  場合も、同期実行かバッチかによってこの点の要否が変わる可能性があり、design で確認する。
- **Code for IBM iのジョブログ取得に専用APIは無い**（F7）。`runSQL`経由での取得になる。
- **`RUCRTRPG`は既定タイムアウト（20秒程度）では終わらないことがある**
  （`.claude/skills/rpgunit-test/SKILL.md:524-525`）。Code for IBM iの`runCommand`/
  `sendCommand`のタイムアウト設定・非同期実行の扱いをdesignで確認する。

## design への申し送り

- Code for IBM iのcontent API（ファイル直接アップロード/ダウンロード）の正確な
  シグネチャを、design着手前に一次ソースで確定する（A6）。
- SR-OSAKAへのCODECOV（5770WDS）導入有無を実機確認してから、コードカバレッジを
  MVPスコープに含めるか、導入作業を別タスクに切り出すかをdesignで判断する（リスク2）。
- 既存の `tools/run-rpgunit.mjs` のコマンド構築・XML解析ロジック（F14, F15）を、
  実行トランスポートだけCode for IBM iのAPIに差し替える形で移植する設計にする。
- テスト検出条件（拡張子だけでなくRPGUnit規約による絞り込み。A3）を具体的に定める。
- Code for IBM i未導入時のソフト検出・エラー案内は、`20260910-ibmi-source-member-sync`の
  D1（撤回前）と同じパターン（`extensionDependencies`に追加せず実行時検出）で設計する
  （requirements.mdで既に方針確定済み）。
- CODECOVの`.cczip`→VS Code Coverage API変換は、IBM i Testing拡張（Apache-2.0）の
  実装パターンを参考にしつつ自前で設計する（コードの直接流用ではなく方式の参考。
  ライセンス上の扱いはdesignで明記する）。
