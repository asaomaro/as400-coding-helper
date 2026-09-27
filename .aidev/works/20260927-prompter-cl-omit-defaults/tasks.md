# タスク: CL は利用者が入れたものだけ書く（P16）

## タスク
- [x] T1: `buildParameterBody` に既定値を省く扱いを足し、元のソースに無いパラメーターでだけ使う。単体テスト・GUI e2e の期待を更新・実機。
      対象: `vscode-extension/src/prompter/commandText.ts` / `test/unit/prompterRegressions.test.ts` / `dev/prompter-e2e.mjs` / `verify/`
      依存: なし
      AC: AC1, AC2, AC3
