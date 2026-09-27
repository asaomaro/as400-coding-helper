# タスク: C 仕様の演算項目の F1 ヘルプに、入れた命令での意味を出す（P18）

## タスク
- [x] T1: `opcodeFieldHelp`（補完データの `fixedForm` から引く）を足し、`toSerializableState` でヘルプの先頭に付ける。単体テスト・GUI e2e。
      対象: `vscode-extension/src/prompter/{opcodeCandidates,formModel}.ts` / `test/unit/prompterRegressions.test.ts` / `dev/prompter-e2e.mjs`
      依存: なし
      AC: AC1, AC2
