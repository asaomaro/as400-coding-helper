# タスク: 罫線をマウスで引く・動かす

## タスク
- [x] T1: 罫線をキーワードごとの形（`GridShape`）として解き、キーワードを作る・書き換える関数と、編集 `addGrid` / `setGridKeyword` を足す。単体テスト・実機。
      対象: `vscode-extension/src/core/dds/{dspfGrid,dspfLayout,dspfRenderModel,ddsEdit}.ts` / `test/unit/{dspfGrid,dspfGridEdit}.test.ts` / `verify/`
      依存: なし
      AC: AC1, AC2, AC3, AC4, AC5
- [x] T2: 画面の操作（ツールバー・ドラッグで引く・選ぶ・動かす・伸縮・消す・プロパティ）とメッセージの契約。GUI e2e。
      対象: `vscode-extension/src/dds/webview/{ui.ts,ui.css,protocol.ts}` / `test/unit/ddsEditorProtocol.test.ts` / `dev/e2e.mjs`
      依存: T1
      AC: AC1, AC2, AC3, AC4
