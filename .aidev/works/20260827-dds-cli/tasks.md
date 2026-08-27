# タスク: DDS の操作を CLI に載せる

- [x] T1: 引数解析と `run()` の骨格
      対象: `vscode-extension/src/cli/dds.ts`（新規）/ 先例 `src/cli/lint.ts:56` `parseArgs`
- [x] T2: `parse`（依存: T1）
      対象: `src/core/dds/dspfOutline.ts:96` `buildDspfOutline`
- [x] T3: `render`（json / text）（依存: T1）
      対象: `src/core/dds/dspfRenderModel.ts` `buildDspfRenderModel` /
      `src/core/dds/prtfRenderModel.ts:41` `buildPrtfRenderModel`
- [x] T4: `patch`（依存: T1）
      対象: `src/core/dds/ddsEdit.ts:145` `validateDdsEdits` / `:215` `applyDdsEdits`
- [x] T5: package.json に `dds` スクリプト（依存: T1）
      対象: `vscode-extension/package.json:329`
- [x] T6: テスト（依存: T2-T4）
      対象: `vscode-extension/test/unit/ddsCli.test.ts`（新規）
- [x] T7: 回帰（`npm test` / `npm run verify` / e2e）
      対象: 未特定
