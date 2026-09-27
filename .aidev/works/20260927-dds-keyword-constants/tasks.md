# タスク: 文字列の無い定数を扱う（D4）

## タスク
- [x] T1: `readKeywordConstant`（種類と実機の桁数の見本）を足し、行の分類・種別・画面と帳票の配置・一覧・書き換えの検査で使う。単体テスト・実機のリスト。
      対象: `vscode-extension/src/core/dds/{ddsLogicalUnits,dspfLayout,prtfLayout,dspfOutline,ddsEdit}.ts` / `test/unit/ddsEdit.test.ts` / `verify/`
      依存: なし
      AC: AC1, AC2
- [x] T2: 置く入口（定数の種類の選択。VS Code 版・単独起動）と `NewDspfItem.keyword`。GUI e2e。
      対象: `vscode-extension/src/core/dds/{ddsEditWriteBack,fieldChoices,ddsEdit}.ts` / `src/dds/{editorProvider.ts,webview/protocol.ts}` / `dev/{standalone.ts,standalone.html,e2e.mjs}`
      依存: T1
      AC: AC3
