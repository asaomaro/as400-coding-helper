# タスク: F4 の統合テストが止まる問題

- [x] T1: 依存（`@vscode/test-electron`）と `runTests.ts`
      対象: `vscode-extension/package.json` / `test/runTests.ts`
- [x] T2: `suite/index.ts`（`tdd` / 対象 / 新しい API）（依存: T1）
      対象: `vscode-extension/test/suite/index.ts`
- [x] T3: 組み立てとスクリプト（依存: T2）
      対象: `vscode-extension/tsconfig.integration.json` （新規作成）/ `package.json`
- [x] T4: F4 のテストを書き直す（依存: T3）
      対象: `vscode-extension/test/integration/f4Prompter.test.ts`
- [x] T5: 止まる形に戻して落ちることを確かめる（依存: T4）
- [x] T6: CI に載せる（依存: T4）
      対象: `.github/workflows/prompter-definitions.yml`
