# タスク: 様式の改名と参照追随

- [x] T1: 実機で規則を確かめる
      対象: `.aidev/works/20260828-dds-record-rename/verify/probe-record-names.mjs`
- [x] T2: `RECORD_ARGUMENTS` と検索・置換（依存: T1）
      対象: `vscode-extension/src/core/dds/ddsReferences.ts` / 根拠: research A1
- [x] T3: `renameRecord` の型・検証・適用（依存: T2）
      対象: `vscode-extension/src/core/dds/ddsEdit.ts` / 根拠: research A2
- [x] T4: プロトコル（依存: T3）
      対象: `vscode-extension/src/dds/webview/protocol.ts`
- [x] T5: UI（名前の入力欄・断り書き・件数）（依存: T3）
      対象: `vscode-extension/src/dds/webview/ui.ts` `renderRecordProperties` / 根拠: research A3, A4
- [x] T6: 単体テスト（依存: T3）
      対象: `vscode-extension/test/unit/ddsRecordRename.test.ts` （新規作成）
- [x] T7: e2e（依存: T5）
      対象: `vscode-extension/dev/e2e.mjs` / `dev/standalone.ts`
- [x] T8: 実機で書き出しを確かめる（対照つき）（依存: T3）
      対象: `.aidev/works/20260828-dds-record-rename/verify/verify-record-rename-compiles.mjs`
