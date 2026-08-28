# タスク: 帳票の強調

- [x] T1: 実機でレベルとカラー名を確かめる
      対象: `.aidev/works/20260828-dds-prtf-emphasis/verify/probe-prtf-appearance.mjs`
- [x] T2: 原典から生成 ＋ 検査（依存: T1）
      対象: `docs/origin/generate-dds-print-appearance.mjs` / `verify-dds-print-appearance.mjs` （新規作成）
- [x] T3: `prtfAppearance.ts`（依存: T2）
      対象: `vscode-extension/src/core/dds/prtfAppearance.ts` （新規作成）/ 根拠: research A4
- [x] T4: `toRenderItem` を種別で分ける（依存: T3）
      対象: `vscode-extension/src/core/dds/ddsRenderItem.ts:153` / 根拠: research A1, A2
- [x] T5: 描画（依存: T4）
      対象: `vscode-extension/src/dds/webview/ui.ts:672` / `ui.css` / 根拠: research A3
- [x] T6: 単体テスト（依存: T4）
      対象: `vscode-extension/test/unit/prtfAppearance.test.ts` （新規作成）
- [x] T7: e2e（依存: T5）
      対象: `vscode-extension/dev/standalone.ts` / `dev/e2e.mjs`
