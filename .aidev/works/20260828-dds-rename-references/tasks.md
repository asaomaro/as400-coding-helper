# タスク: 名前変更の参照追随

- [x] T1: `ddsReferences.ts`（引数の切り出し・参照の表・検索と置換）
      対象: `vscode-extension/src/core/dds/ddsReferences.ts` （新規作成）/ 根拠: research A2
- [x] T2: `setAttributes` の `name` に追随を足す（依存: T1）
      対象: `vscode-extension/src/core/dds/ddsEdit.ts` `case "setAttributes"` / 根拠: research A1
- [x] T3: UI（断り書きの訂正・件数の通知）（依存: T2）
      対象: `vscode-extension/src/dds/webview/ui.ts:1025` / 根拠: research A3, F5
- [x] T4: 単体テスト（追随する / しない・一部一致）（依存: T2）
      対象: `vscode-extension/test/unit/ddsRenameReferences.test.ts` （新規作成）
- [x] T5: `verify-dds-references.mjs` ＋ `npm run verify`（依存: T1）
      対象: `docs/origin/verify-dds-references.mjs` （新規作成）
- [x] T6: 実機で書き出しを確かめる（依存: T2）
      対象: `.aidev/works/20260828-dds-rename-references/verify/` （新規作成）
- [x] T7: e2e（依存: T3）
      対象: `vscode-extension/dev/e2e.mjs`
