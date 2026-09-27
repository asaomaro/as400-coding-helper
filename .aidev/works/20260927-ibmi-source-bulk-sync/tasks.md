# タスク: ソース・ファイル単位でメンバーを一括で送受信する

## タスク
- [x] T1: core（vscode 非依存）: 一覧コマンドの組み立て・JSON の読み取り・ローカルとの突き合わせ・上書き確認の対象・新規ファイル名。
      対象: `vscode-extension/src/sync/bulkSync.ts` / `test/unit/bulkSync.test.ts`
      依存: なし
      AC: AC1, AC2, AC4, AC5
- [x] T2: transport に `listMembers` を足す（`RUNSQL` → SFTP 読み → 後始末）。
      対象: `vscode-extension/src/sync/ibmiSourceTransport.ts` / 単体テスト
      依存: T1
      AC: AC1
- [x] T3: 画面（WebView 4 点セット）とホスト（パネル・差分・転送・日時合わせ）、コマンドとメニュー。
      対象: `vscode-extension/src/sync/{bulkSyncPanel.ts,webview/*}` / `package.json` / `esbuild.webview.mjs` / tsconfig
      依存: T1, T2
      AC: AC3, AC5, AC6
- [x] T4: 単独起動ハーネスと GUI e2e、CI に足す。実機で一覧の SQL を確かめる。
      対象: `vscode-extension/dev/sync-*` / `.github/workflows/prompter-definitions.yml` / `verify/`
      依存: T3
      AC: AC1, AC3
