# タスク: PRTF をビジュアルエディタで開く

- [x] T1: 翻訳を種別に依らない形へ切り出す
      対象: `vscode-extension/src/core/dds/ddsRenderItem.ts`（新規）/ 根拠: research A1, F4
- [x] T2: `PlacedItem` に翻訳に要る欄を足す
      対象: `vscode-extension/src/core/dds/prtfLayout.ts:33` / 根拠: research A2
- [x] T3: 帳票の描画モデル（依存: T1, T2）
      対象: `vscode-extension/src/core/dds/prtfRenderModel.ts`（新規）
- [x] T4: `moveColumn` と `row-from-spacing`
      対象: `vscode-extension/src/core/dds/ddsEdit.ts` / `ddsPositionWriteBack.ts` / 根拠: research F3
- [x] T5: ホストの結線（`.prtf` の登録・設定・題材）（依存: T3）
      対象: `vscode-extension/package.json` / `src/dds/editorProvider.ts` / `dev/standalone.ts`
- [x] T6: UI（種別での出し分け・横だけのドラッグ・オーバーフロー行）（依存: T3, T4）
      対象: `vscode-extension/src/dds/webview/ui.ts` / `ui.css` / `protocol.ts`
- [x] T7: 単体テスト（依存: T3, T4）
      対象: `vscode-extension/test/unit/prtfRenderModel.test.ts`（新規）
- [x] T8: GUI e2e（依存: T5, T6）
      対象: `vscode-extension/dev/e2e.mjs`
- [x] T9: 実機で行送りを確かめる（依存: T3）
      対象: `.aidev/works/20260827-dds-prtf-editor/verify/`
- [x] T10: 記録（backlog・設計文書）（依存: 全部）
      対象: `.aidev/backlog/dds.md` / `docs/design/dds-designer/README.md`
