# タスク: 行の高さを LPI で決める

- [x] T1: `PlacedItem.lpi`
      対象: `vscode-extension/src/core/dds/prtfLayout.ts:45`
- [x] T2: `RenderItem` へ `inches` / `lpi` を運ぶ（依存: T1）
      対象: `vscode-extension/src/core/dds/ddsRenderItem.ts`
- [x] T3: 紙の比率での配置（依存: T2）
      対象: `vscode-extension/src/dds/webview/ui.ts`
- [x] T4: 単体 ＋ e2e（依存: T3）
      対象: `vscode-extension/test/unit/prtfPages.test.ts` / `dev/e2e.mjs`
