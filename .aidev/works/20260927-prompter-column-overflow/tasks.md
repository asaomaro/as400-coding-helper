# タスク: 桁幅を超える値を黙って切り捨てない

## タスク
- [x] T1: `validate`（`model.ts`）で桁幅を超える値をエラーにする。単体テストと GUI e2e（C-SPEC の見本を足す）。
      対象: `vscode-extension/src/prompter/model.ts` / `test/unit/prompterRegressions.test.ts` / `dev/prompter-e2e.mjs` / `dev/prompter-standalone.ts`
      依存: なし
      AC: AC1, AC2, AC3
