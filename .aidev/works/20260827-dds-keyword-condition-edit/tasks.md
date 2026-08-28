# タスク: キーワード行の条件を編集する

- [x] T1: 群に置き換え範囲（`sourceLines`）を持たせる
      対象: `src/core/dds/ddsLogicalUnits.ts` `RawKeywordGroup` / `src/core/dds/ddsConditioning.ts` `KeywordGroup`
- [x] T2: `setKeywordCondition` の検証と適用（依存: T1）
      対象: `src/core/dds/ddsEdit.ts` `keywordGroupAt` / `validateConditionShape`
- [x] T3: メッセージの型検査（依存: T2）
      対象: `src/dds/webview/protocol.ts` `parseEdit`
- [x] T4: プロパティの「キーワード行」欄（依存: T3）
      対象: `src/dds/webview/ui.ts` `describeConditionalKeywords` / `ui.css`
- [x] T5: テストと e2e（依存: T4）
      対象: `test/unit/ddsConditionEdit.test.ts` / `dev/e2e.mjs`
- [x] T6: 回帰
      対象: 未特定
