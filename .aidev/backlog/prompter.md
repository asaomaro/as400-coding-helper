---
backlog: prompter
kind: standing        # standing（定常ドメインキュー）| split（タスク分割由来・短命）
priority: 1           # 既存機能の構造改善。display（不具合）の次
---
# F4 プロンプター バックログ

`vscode-extension/src/prompter/` と `src/extension/commands/showPrompter.ts` に関するキュー。

`aidev-util-batch` が消化する対象リスト。各未チェック行 = 1件のタスク。

## 項目

- [ ] **F4 プロンプターを VSCode 非依存（standalone 基準）に作り替え、Playwright で自律テストできるようにする**

  **狙い**: DDS ビジュアルエディタで確立した構造（判断はコア / UI は描くだけ / `acquireVsCodeApi` は
  bridge の 1 か所 / ホスト能力を宣言）をプロンプターにも適用し、**VSCode の外で動かして
  自動でテストできる**状態にする。

  **現状（2026-08-26 実測）**:
  - `src/prompter/` は **2,086 行 / 12 ファイル、うち 8 ファイルが `vscode` を import**。
  - UI は `binding.ts`（**636 行**）が HTML + CSS + インラインスクリプトを**文字列で組み立てる**。
  - `showPrompter.ts:104` が `await openPrompter(...)`——この Promise は**利用者が送信／取消するまで
    解決しない**。統合テストで `await executeCommand("rpgClSupport.showPrompter")` すると
    永久に返らず、**拡張ホストごと落ちて統合スイート全体が止まっていた**。
    2026-08-26 に「await しない」形へ**最小修正済み**（`20260825-dds-visual-editor/decisions.md` D1）。
    構造は手つかず。

  **参考にする実装**（DDS 側で動いているもの）:
  - `vscode-extension/src/dds/webview/protocol.ts` — メッセージ契約 ＋ `Host`（ホストが何を肩代わりするか）
  - `vscode-extension/src/dds/webview/bridge.ts` — `acquireVsCodeApi` の唯一の呼び出し箇所
  - `vscode-extension/dev/standalone.ts` / `dev/e2e.mjs` — 単独起動ハーネスと実操作 e2e（21 件）
  - `vscode-extension/tsconfig.webview.json` — `types: []` で **WebView から `vscode` を型ごと締め出す**

  **規模の見立て**: `07-editor-webview` と同等かそれ以上（コア抽出 → protocol/bridge → UI 再実装 →
  standalone ハーネス → e2e → 既存挙動の非後退確認）。**単独の work として起こす**
  （DDS の PR に混ぜるとレビュー単位が壊れる、というユーザー判断 2026-08-26）。

  **非後退で守るもの**: F4 の起動経路（キーバインド・コマンド）、定義 JSON の読み込み、
  可変パラメータ・グルーピング・ヘルプ（F1）、`applyChanges` の桁書き戻し。

  出所: ユーザー要望（2026-08-26）＋ `20260825-dds-visual-editor/decisions.md` D1。
