# タスク: キーワード欄のチップ表示と原典ヘルプ

- [x] T1: キーワード欄の解析（`parseKeywordEntries`）
      対象: `vscode-extension/src/core/dds/ddsKeywords.ts`（新規）/ 根拠: research A1
- [x] T2: 解説の型と 2 段の引き当て（`DdsKeywordHelp` / `findKeywordHelp`）
      対象: 同上 / 根拠: research A2, F7
- [x] T3: 既存の補完が core の型を使うようにする（振る舞いは変えない）（依存: T2）
      対象: `vscode-extension/src/language/ddsKeywordCompletion.ts:24`
- [x] T4: `load` に解説表を足す（任意フィールド）（依存: T2）
      対象: `vscode-extension/src/dds/webview/protocol.ts:41` / 根拠: research A3
- [x] T5: VSCode 側で表を読んで渡す（依存: T4）
      対象: `vscode-extension/src/dds/editorProvider.ts:110` / 根拠: research A4
- [x] T6: 単独起動側で表を束ねて渡す（依存: T4）
      対象: `vscode-extension/dev/standalone.ts:13` / 根拠: research A5
- [x] T7: UI にチップと解説を出す（依存: T1, T2, T4）
      対象: `vscode-extension/src/dds/webview/ui.ts` `renderProperties` / 根拠: research A6
- [x] T8: 見た目（依存: T7）
      対象: `vscode-extension/src/dds/webview/ui.css`
- [x] T9: 単体テスト（解析の表・2 段の引き当て・実データでの引き当て）（依存: T1-T6）
      対象: `vscode-extension/test/unit/ddsKeywords.test.ts`（新規）
- [x] T10: GUI e2e（依存: T7, T8）
      対象: `vscode-extension/dev/e2e.mjs`
- [x] T11: 記録（設計文書・backlog）（依存: 全部）
      対象: `docs/design/dds-designer/README.md` / `.aidev/backlog/dds.md`
