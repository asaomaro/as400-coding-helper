# タスク: 画面の罫線（GRDBOX / GRDLIN）を描く

## タスク
- [x] T1: `dspfGrid.ts`（罫線を境目の線分に直す）を足し、配置解決・描画モデル・標識の適用に載せる。単体テスト。
      対象: `vscode-extension/src/core/dds/{dspfGrid,dspfLayout,dspfRenderModel}.ts` / `test/unit/dspfGrid.test.ts`
      依存: なし
      AC: AC1, AC2, AC3
- [x] T2: 画面で線を描く（色・線種は CSS）。単独起動の見本と GUI e2e。
      対象: `vscode-extension/src/dds/webview/{ui.ts,ui.css}` / `dev/{standalone.ts,e2e.mjs}`
      依存: T1
      AC: AC1, AC3
