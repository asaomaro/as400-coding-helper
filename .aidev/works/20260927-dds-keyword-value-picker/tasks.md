# タスク: キーワードの値をドロップダウン／チェックボックスで選ぶ

## タスク
- [x] T1: 生成スクリプト（`generate-dds-keyword-values.mjs`）で `dds-keywords*.json` に `values`（位置ごとの値の一覧）を入れ、`verify:defs` に `--check` を足す。
      対象: `docs/origin/generate-dds-keyword-values.mjs` / `vscode-extension/resources/completion/dds-keywords*.json` / `vscode-extension/package.json`
      依存: なし
      AC: AC1
- [x] T2: 値を読む・書く core（`ddsKeywordValues.ts`）と単体テスト。
      対象: `vscode-extension/src/core/dds/{ddsKeywordValues,ddsKeywords}.ts` / `test/unit/ddsKeywordValues.test.ts`
      依存: T1
      AC: AC2, AC3
- [x] T3: 画面の選択 UI（足すとき・チップを開いたとき）と GUI e2e、実機の確認。
      対象: `vscode-extension/src/dds/webview/{ui.ts,ui.css}` / `dev/e2e.mjs` / `verify/`
      依存: T2
      AC: AC2, AC3, AC4
