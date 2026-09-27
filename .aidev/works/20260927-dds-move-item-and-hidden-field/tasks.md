# タスク: 項目を別の様式へドラッグで移す／潜在フィールドを一覧から足す

## タスク
- [x] T1: core の `moveToRecord` と、位置なしの `add`（位置を持てない使用のときだけ）。単体テスト。
      対象: `vscode-extension/src/core/dds/{ddsEdit,ddsEditWriteBack}.ts` / `src/dds/webview/protocol.ts` / `test/unit/ddsEdit.test.ts`
      依存: なし
      AC: AC1, AC2, AC4
- [x] T2: 一覧のドラッグ＆ドロップと「＋ 潜在」、ホストの問い合わせ（`askItem` の `hidden`）。GUI e2e。
      対象: `vscode-extension/src/dds/{webview/ui.ts,webview/ui.css,webview/main.ts,editorProvider.ts}` / `dev/{standalone.ts,e2e.mjs}`
      依存: T1
      AC: AC3, AC4
