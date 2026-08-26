---
backlog: tooling
kind: standing        # standing（定常ドメインキュー）| split（タスク分割由来・短命）
priority: 2           # 開発基盤。既存挙動の不具合（display）より後、定義追加と同程度
---
# 開発基盤バックログ

ビルド・テスト・CI など、製品機能ではないが**回帰を拾える仕組み**に関するキュー。

`aidev-util-batch` が消化する対象リスト。各未チェック行 = 1件のタスク。

## 項目

- [ ] **VSCode 統合テストを CI に載せる（`xvfb-run`）**

  `vscode-extension/test/integration/*.test.ts` は **手元でしか動いていない**。
  `npm run test:integration` は `@vscode/test-electron` が VSCode 本体（約 1.2GB）を落として
  実際に起動するため、表示環境が要る。GitHub Actions の ubuntu ランナーには `xvfb` があるので
  `xvfb-run -a npm run test:integration` で回せる見込み。

  **現状（2026-08-26 実測）**: 77 件が WSLg 環境で合格。ただし**同じ環境で 1 度、
  拡張ホストが読み込み直後に終了して出力ゼロで落ちた**（GPU 関連のエラーが出ていた）。
  安定性の見極めが要る。

  **判断の前提**: 不安定なテストを CI に置くと赤を無視する習慣がつく。
  **再現率を測ってから**載せること（例: 10 回連続で緑を確認）。VSCode 本体のキャッシュ
  （`.vscode-test/`）を actions/cache に載せないと毎回 1.2GB を落とすことになる点にも注意。

  出所: `20260825-dds-visual-editor` の `decisions.md` D3。

- [ ] **GUI の e2e を CI に載せる（`playwright-core` ＋ ブラウザ）**

  `vscode-extension/dev/e2e.mjs`（単独起動ハーネスを実操作する 21 件）も手元専用。
  `playwright-core` を devDependency にしていないのは、**CI ではブラウザ本体が無く動かせず、
  入れると「CI に載っているのに走っていないテスト」が生まれる**ため。
  CI に載せるなら `npx playwright install chromium` とキャッシュをセットで用意する。

  出所: `20260825-dds-visual-editor/07-editor-webview` の `decisions.md` D15。

- [ ] **`createNonce` の重複を解消する**

  `vscode-extension/src/prompter/webview.ts` と `vscode-extension/src/dds/webviewHtml.ts` に
  同じ実装がある（10 行ほど）。**プロンプターの standalone 化（`prompter.md`）が
  このファイルを作り替える**ので、そこで共通化するのが自然。単独で動かすと差分が衝突する。

  出所: `20260825-dds-visual-editor` の `review.md` nit-2。
