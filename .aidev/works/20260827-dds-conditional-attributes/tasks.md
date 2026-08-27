# タスク: 条件つきの `COLOR` / `DSPATR` を条件として扱う

- [x] T1: `KeywordGroup` と `LogicalUnit.keywordGroups`
      対象: `src/core/dds/ddsLogicalUnits.ts:220` `toLogicalUnits`
- [x] T2: `keywords` と `keywordGroups` の一致を検査（依存: T1）
      対象: `test/unit/ddsConditionalAttributes.test.ts`（新規）
- [x] T3: `PlacedItem` / `PlacedSource` / `RenderItem` に載せる（依存: T1）
      対象: `src/core/dds/dspfLayout.ts:370` / `prtfLayout.ts:314` / `ddsRenderItem.ts:105`
- [x] T4: `resolveAppearanceUnder`（依存: T1）
      対象: `src/core/dds/dspfAttributes.ts:120` `resolveAppearance`
- [x] T5: `applyIndicators` で見え方を作り直す（依存: T4）
      対象: `src/core/dds/dspfRenderModel.ts` `applyIndicators`
- [x] T6: プロパティに条件つきキーワードを出す（依存: T3）
      対象: `src/dds/webview/ui.ts:1185`
- [x] T7: e2e（依存: T6）
      対象: `vscode-extension/dev/e2e.mjs`
- [x] T8: 回帰（`npm test` / `npm run verify` / e2e）
      対象: 未特定
