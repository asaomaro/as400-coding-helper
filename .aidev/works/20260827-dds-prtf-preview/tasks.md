# タスク: 帳票のプレビューモード（CPI / LPI）

- [x] T1: 原典から値の集合を生成
      対象: `docs/origin/generate-dds-print-density.mjs`（新規）/ 根拠: research F1
- [x] T2: 検査を足して `npm run verify` に登録（依存: T1）
      対象: `docs/origin/verify-dds-print-density.mjs`（新規）/ `vscode-extension/package.json`
- [x] T3: core（値の集合・ソースからの読み取り・紙の大きさ）（依存: T1）
      対象: `vscode-extension/src/core/dds/prtfDensity.ts`（新規）/ 根拠: research F2, F3
- [x] T4: 描画モデルに載せる（依存: T3）
      対象: `vscode-extension/src/core/dds/prtfRenderModel.ts` / `dspfRenderModel.ts`
- [x] T5: UI（切替・選択・用紙・物理セル）（依存: T4）
      対象: `vscode-extension/src/dds/webview/ui.ts` / `ui.css` / 根拠: research A3, A4, F4
- [x] T6: 単体テスト（依存: T3, T4）
      対象: `vscode-extension/test/unit/prtfDensity.test.ts`（新規）
- [x] T7: GUI e2e（依存: T5）
      対象: `vscode-extension/dev/e2e.mjs`
- [x] T8: 実機で値の集合を確かめる（依存: T3）
      対象: `.aidev/works/20260827-dds-prtf-preview/verify/`
- [x] T9: 記録（backlog・設計文書）（依存: 全部）
      対象: `.aidev/backlog/dds.md` / `docs/design/dds-designer/README.md`
