# タスク: ウィンドウ様式の枠と相対位置・サブファイルの 1 ページ（D12・D13）

## タスク
- [x] T1: `dspfWindow.ts`（様式ごとのウィンドウ・サブファイルの並べ方）を足し、配置解決（`dspfLayout`）と描画モデルに `origin` / `repeat` / `windows` を載せる。はみ出しをウィンドウで判定。単体テスト。
      対象: `vscode-extension/src/core/dds/{dspfWindow,dspfLayout,dspfRenderModel,ddsRenderItem}.ts` / `test/unit/dspfWindow.test.ts`
      依存: なし
      AC: AC1, AC2, AC3, AC4
- [x] T2: 画面で枠・メッセージ行・サブファイルの写しを描き、ドラッグ・矢印キー・置く位置をウィンドウの中の位置に直す。GUI e2e・単独起動の見本。
      対象: `vscode-extension/src/dds/webview/{ui.ts,ui.css}` / `dev/{standalone.ts,e2e.mjs}`
      依存: T1
      AC: AC1, AC2, AC4
