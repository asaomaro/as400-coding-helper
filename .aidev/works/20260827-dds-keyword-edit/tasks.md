# タスク: キーワード欄の編集

- [x] T1: 折り返し（`foldKeywordArea` / `buildKeywordLine`）
      対象: `vscode-extension/src/core/dds/ddsEditWriteBack.ts` / 根拠: research A1, F1
- [x] T2: `setKeywords` の適用と検証（依存: T1）
      対象: `vscode-extension/src/core/dds/ddsEdit.ts:45` `:174` / 根拠: research A2, A3
- [x] T3: 継続にまたがる `text` を同じ経路へ（`keyword-continuation` を外す）（依存: T2）
      対象: 同上
- [x] T4: プロトコルが `setKeywords` を通す（依存: T2）
      対象: `vscode-extension/src/dds/webview/protocol.ts` / 根拠: research A4
- [x] T5: UI（チップの `✕` / `＋` と候補 / 生テキストの編集）（依存: T4）
      対象: `vscode-extension/src/dds/webview/ui.ts` `keywordSection` / 根拠: research A5, F4
- [x] T6: 単体テスト（折り返しの表・往復の総当たり・拒否）（依存: T1-T3）
      対象: `vscode-extension/test/unit/ddsKeywordEdit.test.ts`（新規）
- [x] T7: GUI e2e（依存: T5）
      対象: `vscode-extension/dev/e2e.mjs`
- [x] T8: 実機で往復を確かめる（依存: T6）
      対象: `.aidev/works/20260827-dds-keyword-edit/verify/`
- [x] T9: 記録（backlog・設計文書）（依存: 全部）
      対象: `.aidev/backlog/dds.md` / `docs/design/dds-designer/README.md`
