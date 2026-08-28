# タスク: ファイル・レベルのキーワードをデザイナから読めるようにする

- [x] T1: 分類を切り出す
      対象: `src/core/dds/ddsLogicalUnits.ts` `classifyDdsLine`
- [x] T2: `fileLevelKeywordLines`（依存: T1）
      対象: 同上
- [x] T3: モデルに載せる（依存: T2）
      対象: `src/core/dds/dspfRenderModel.ts` `toFileKeywords` / `prtfRenderModel.ts`
- [x] T4: 一覧とプロパティ（依存: T3）
      対象: `src/dds/webview/ui.ts` `renderOutline` / `renderFileKeywordProperties` / `ui.css`
- [x] T5: CLI の `parse`（依存: T3）
      対象: `src/cli/dds.ts`
- [x] T6: テストと e2e（依存: T4, T5）
      対象: `test/unit/ddsFileKeywords.test.ts`（新規）/ `test/unit/ddsCli.test.ts` / `dev/e2e.mjs`
