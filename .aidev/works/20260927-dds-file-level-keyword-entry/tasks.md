# タスク: ファイル・レベルのキーワードを 1 つ目から足せるようにする

## タスク
- [x] T1: core の `addFileKeywords`（検証つき）・契約・空の括弧の検証。単体テスト。
      対象: `vscode-extension/src/core/dds/{ddsEdit,ddsSourceDiagnostics,ddsKeywords}.ts` / `src/dds/webview/protocol.ts` / テスト
      依存: なし
      AC: AC1, AC2, AC3, AC4
- [x] T2: UI（「ファイル」の節・レベル違いの拒否・括弧の続きを打たせる）。GUI e2e。
      対象: `vscode-extension/src/dds/webview/ui.ts` / `dev/e2e.mjs`
      依存: T1
      AC: AC1, AC2, AC3
- [x] T3: 実機で確かめる。
      対象: `verify/`
      依存: T1
      AC: AC5
