# タスク: ファイル・レベルのキーワードを編集できるようにする

- [x] T1: `FileKeywordLine.sourceLines`
      対象: `src/core/dds/ddsLogicalUnits.ts` `fileLevelKeywordLines`
- [x] T2: `setKeywords` の宛先を広げる（依存: T1）
      対象: `src/core/dds/ddsEdit.ts` `fileLevelAt`
- [x] T3: UI（依存: T2）
      対象: `src/dds/webview/ui.ts` `renderFileKeywordProperties`
- [x] T4: テストと e2e（依存: T3）
      対象: `test/unit/ddsFileKeywords.test.ts` / `dev/e2e.mjs`
