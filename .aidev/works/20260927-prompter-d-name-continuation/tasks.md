# タスク: D 仕様の名前を継続名前行に分け、字下げを残す（P21）

## タスク
- [x] T1: 継続名前行の読み書き（`rpgNameContinuation.ts`）と `keepIndent` / `nameContinuation` の属性。読み込み・検査・書き戻しにつなぐ。単体テスト・本物の VS Code・実機。
      対象: `vscode-extension/src/prompter/{rpgNameContinuation,types,model,commandText,initialValues,applyChanges}.ts` / `resources/prompter/rpg/ile/{ja,en}/D-SPEC.json` / `docs/origin/rpg-spec-en-strings.json` / テスト / `verify/`
      依存: なし
      AC: AC1, AC2, AC3, AC4
