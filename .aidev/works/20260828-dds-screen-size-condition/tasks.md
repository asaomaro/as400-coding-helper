# タスク: 画面サイズ条件名を編集する

- [x] T1: 桁の書き戻しと短い形の分岐
      対象: `src/core/dds/ddsConditionWriteBack.ts` `formatScreenSizeArea` / `parseConditionText`
- [x] T2: 検証と適用（依存: T1）
      対象: `src/core/dds/ddsEdit.ts` `validateConditionShape`
- [x] T3: 受け渡しと入力欄（依存: T2）
      対象: `src/dds/webview/protocol.ts` `parseEdit` / `src/dds/webview/ui.ts` `conditionInput`
- [x] T4: テストと e2e（依存: T3）
      対象: `test/unit/ddsConditionEdit.test.ts` / `dev/e2e.mjs`
- [x] T5: 回帰
      対象: 未特定
