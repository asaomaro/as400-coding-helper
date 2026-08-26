---
backlog: prompter
kind: standing        # standing（定常ドメインキュー）| split（タスク分割由来・短命）
priority: 1           # 既存機能の構造改善。DDS(1) と同格
---
# F4 プロンプター バックログ

`vscode-extension/src/prompter/` と `src/extension/commands/showPrompter.ts` に関するキュー。

`aidev-util-batch` が消化する対象リスト。各未チェック行 = 1件のタスク。

## 項目

- [ ] **F4 プロンプターを VSCode 非依存（standalone 基準）に作り替え、Playwright で自律テストできるようにする**

  **狙い**: DDS ビジュアルエディタ（`20260826-dds-editor-port` / PR #109）で確立した構造
  ——判断はコア / UI は描くだけ / `acquireVsCodeApi` は bridge の 1 か所 / ホスト能力を宣言——
  をプロンプターにも適用し、**VSCode の外で動かして自動でテストできる**状態にする。

  **現状（2026-08-27 実測・現 main）**:
  - `src/prompter/` は **4,718 行 / 17 ファイル、うち 9 ファイルが `vscode` を import**。
  - UI は `binding.ts`（**1,401 行**）が HTML + CSS + インラインスクリプトを**文字列で組み立てる**。
    状態は WebView 内に持ち、確定時にまとめて受け取る作り。
  - 次に大きいのは `applyChanges.ts`(498) / `cdmlRules.ts`(394) / `clCommandParser.ts`(392) /
    `model.ts`(382) / `types.ts`(307)。**桁の書き戻しと検証はコア側に寄っており、再利用できる**。

  **参考にする実装**（PR #109 で動いているもの）:
  - `src/dds/webview/protocol.ts` — メッセージ契約 ＋ ホストが何を肩代わりするかの宣言
  - `src/dds/webview/bridge.ts` — `acquireVsCodeApi` の唯一の呼び出し箇所
  - `src/dds/webview/ui.ts` / `geometry.ts` — 素の web の UI と、純関数の座標計算
  - `dev/standalone.ts` / `dev/e2e.mjs` — 単独起動ハーネスと実操作 e2e（15 件）
  - `tsconfig.webview.json` — `types: []` で **WebView から `vscode` を型ごと締め出す**
  - `esbuild.webview.mjs` — WebView だけを束ねる（拡張ホストは tsc のまま）

  **規模の見立て**: DDS エディタ（新規 12 ファイル・約 4,000 行）と同等かそれ以上。
  **単独の work として起こす**（他の変更に混ぜるとレビュー単位が壊れる）。

  **非後退で守るもの**: F4 の起動経路（キーバインド・`resourceExtname` の条件）、
  定義 JSON の読み込み、可変パラメータ・グルーピング・ヘルプ（F1）、
  `applyChanges` の桁書き戻し、CL 往復検証（`npm run verify` の `verify:roundtrip`）。

  出所: ユーザー要望（2026-08-26）。

- [ ] **F4 の統合テストが止まる問題を直す**

  `test/integration/f4Prompter.test.ts:17` が
  `await vscode.commands.executeCommand("rpgClSupport.showPrompter")` しているが、
  `showPrompter.ts:95` は `await openPrompter(...)`——**利用者が送信／取消するまで解決しない
  Promise** を待つ。テストからは永久に返らず、**拡張ホストごと落ちて統合スイート全体が止まる**。

  実測（2026-08-26・別ブランチで確認）: VSCode 1.134.0 を起動し、単体と
  `Sample Integration` までは走ったあと、このスイートで停止した。

  **影響**: VSCode 上の統合テストが 1 本も回せない。DDS エディタの器
  （`WorkspaceEdit`・undo・カスタムエディタの登録）を機械的に確かめる経路がここで塞がっている。

  **直し方**: await をやめ、「一定時間内に reject しないこと」で「例外なく起動できる」ことだけを見る。
  併せて `teardown` でエディタを閉じる。**上の standalone 化に着手するなら、その中で
  作り替えるほうが自然**（テストごと置き換わるため）。
