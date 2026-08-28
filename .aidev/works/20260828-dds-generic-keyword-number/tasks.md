# タスク: 総称のキーワードに番号を入れさせる

- [x] T1: 実機で通る形・通らない形を確かめる
      対象: `.aidev/works/20260828-dds-generic-keyword-number/verify/probe-generic-keyword.mjs`
- [x] T2: `genericKeywordPrefix` / `genericKeywordRange`（依存: T1）
      対象: `vscode-extension/src/core/dds/ddsKeywords.ts:179` / 根拠: research A2
- [x] T3: `＋` の確定に分岐を入れる（依存: T2）
      対象: `vscode-extension/src/dds/webview/ui.ts` `addKeywordButton` / 根拠: research A1
- [x] T4: 単体テスト（依存: T2）
      対象: `vscode-extension/test/unit/ddsGenericKeyword.test.ts` （新規作成）
- [x] T5: e2e（依存: T3）
      対象: `vscode-extension/dev/e2e.mjs`
