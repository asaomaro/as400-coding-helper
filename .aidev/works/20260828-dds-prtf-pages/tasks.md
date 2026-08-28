# タスク: 複数ページの帳票

- [x] T1: `Cursor` に位置・LPI・ページ。`skipTo` / `advance` / `readLpi`
      対象: `vscode-extension/src/core/dds/prtfLayout.ts` / 根拠: research A1
- [x] T2: 項目に `page` / `inches`（依存: T1）
      対象: `vscode-extension/src/core/dds/prtfLayout.ts:45` `PlacedItem`
- [x] T3: `selectPrintPage`（依存: T2）
      対象: `vscode-extension/src/core/dds/prtfRenderModel.ts`
- [x] T4: UI のページ送り / CLI の `--page`（依存: T3）
      対象: `vscode-extension/src/dds/webview/ui.ts` `renderDensity` / `src/cli/dds.ts`
- [x] T5: 単体テスト（原典の計算例）（依存: T2, T3）
      対象: `vscode-extension/test/unit/prtfPages.test.ts` （新規作成）
- [x] T6: e2e（依存: T4）
      対象: `vscode-extension/dev/standalone.ts` / `dev/e2e.mjs`
