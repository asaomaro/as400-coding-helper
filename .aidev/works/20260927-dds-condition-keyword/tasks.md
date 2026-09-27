# タスク: 様式・項目のキーワードに条件（標識）を付けられるようにする

## タスク
- [x] T1: core の `conditionKeyword`（検証つき）と契約。単体テスト。
      対象: `vscode-extension/src/core/dds/ddsEdit.ts` / `src/dds/webview/protocol.ts` / `test/unit/ddsEdit.test.ts`
      依存: なし
      AC: AC1, AC2
- [x] T2: UI の「条件」。GUI e2e。
      対象: `vscode-extension/src/dds/webview/{ui.ts,ui.css}` / `dev/e2e.mjs`
      依存: T1
      AC: AC3
- [x] T3: 実機で確かめる。
      対象: `verify/`
      依存: T1
      AC: AC4
