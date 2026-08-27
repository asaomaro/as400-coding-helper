# タスク: 条件標識を編集する（付け外し）

- [x] T1: 桁への書き戻し
      対象: `src/core/dds/ddsConditionWriteBack.ts`（新規）
- [x] T2: 短い形の読み書き（依存: T1）
      対象: 同上 `formatConditionText` / `parseConditionText`
- [x] T3: `setCondition` の検証と適用（依存: T1）
      対象: `src/core/dds/ddsEdit.ts` `validateDdsEdits` / `applyDdsEdits`
- [x] T4: メッセージの型検査（依存: T3）
      対象: `src/dds/webview/protocol.ts` `parseEdit`
- [x] T5: プロパティの入力欄（依存: T2, T4）
      対象: `src/dds/webview/ui.ts` `conditionInput`
- [x] T6: 行がずれたときの選択（依存: T5）
      対象: `src/dds/webview/ui.ts` `pendingSelection` / `conditionLineCount`
- [x] T7: テストと e2e（依存: T5）
      対象: `test/unit/ddsConditionEdit.test.ts`（新規）/ `dev/e2e.mjs`
- [x] T8: 回帰
      対象: 未特定
