# タスク: 帳票の行送りの様式に行番号を書かない／使用を B にしない

## タスク
- [x] T1: core で置く項目を調整（行番号・使用の既定）し、使用を検査する。単体テスト。
      対象: `vscode-extension/src/core/dds/{ddsEdit,ddsEditWriteBack}.ts` / `src/dds/editorProvider.ts` / `dev/standalone.ts` / `test/unit/ddsEdit.test.ts`
      依存: なし
      AC: AC1, AC2
- [x] T2: 検証の併用の指摘を様式の行送りまで広げる。単体テスト。
      対象: `vscode-extension/src/core/dds/prtfLayout.ts` / `test/unit/prtfLayout.test.ts`
      依存: なし
      AC: AC3
- [x] T3: UI の使用の選択肢・帳票の文言。GUI e2e。
      対象: `vscode-extension/src/dds/webview/ui.ts` / `dev/e2e.mjs`
      依存: T1
      AC: AC1, AC2, AC4
- [x] T4: 実機で確かめる（置く経路で作った帳票と対照）。
      対象: `verify/`
      依存: T1
      AC: AC5
