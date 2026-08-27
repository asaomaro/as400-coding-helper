# タスク: 5250 の配色

- [x] T1: 原典から対応表を生成
      対象: `docs/origin/generate-dds-attributes.mjs`（新規）/ 根拠: research F1, F2
- [x] T2: 検査（原典の 2 表の一致まで）（依存: T1）
      対象: `docs/origin/verify-dds-attributes.mjs`（新規）/ `vscode-extension/package.json`
- [x] T3: core（キーワード → 見え方）（依存: T1）
      対象: `vscode-extension/src/core/dds/dspfAttributes.ts`（新規）/ 根拠: research F6
- [x] T4: **実機との突き合わせ**（全 61 通り）（依存: T3）
      対象: `.aidev/works/20260827-dds-5250-colors/verify/verify-attributes.mjs` / 根拠: research F5
- [x] T5: 描画モデルに載せる（依存: T3）
      対象: `vscode-extension/src/core/dds/dspfRenderModel.ts:38`
- [x] T6: UI（配色と切替）（依存: T5）
      対象: `vscode-extension/src/dds/webview/ui.ts` / `ui.css`
- [x] T7: 単体テスト（依存: T3, T4）
      対象: `vscode-extension/test/unit/dspfAttributes.test.ts`（新規）
- [x] T8: GUI e2e（依存: T6）
      対象: `vscode-extension/dev/e2e.mjs`
- [x] T9: 記録（backlog・設計文書）（依存: 全部）
      対象: `.aidev/backlog/dds.md` / `docs/design/dds-designer/README.md`
