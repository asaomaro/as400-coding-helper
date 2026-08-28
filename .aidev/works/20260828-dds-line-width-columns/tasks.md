# タスク: 行長の数え方を実機の桁に揃える

- [x] T1: 実機で切れる場所と欄に入る量を測る
      対象: `.aidev/works/20260828-dds-line-width-columns/verify/probe-*.mjs`
- [x] T2: `indexExceedingWidth` を足す（依存: T1）
      対象: `vscode-extension/src/core/dbcs.ts:49` / 根拠: research A1
- [x] T3: lint を `printWidth` にする（依存: T2）
      対象: `vscode-extension/src/lint/rules/lineLength.ts` / 根拠: research A2
- [x] T4: 編集の上限を `printWidth` にする（依存: T2）
      対象: `vscode-extension/src/core/dds/ddsEdit.ts:833` / 根拠: research A3
- [x] T5: 折り返しを `printWidth` にする（依存: T2）
      対象: `vscode-extension/src/core/dds/ddsEditWriteBack.ts` `foldKeywordArea` / 根拠: research A4
- [x] T6: 単体テスト（依存: T3, T4, T5）
      対象: `vscode-extension/test/unit/ddsLineWidth.test.ts` （新規作成）
- [x] T7: 実機で折った結果を通す（依存: T5）
      対象: `.aidev/works/20260828-dds-line-width-columns/verify/verify-folded-dbcs.mjs`
