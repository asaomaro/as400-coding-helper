# タスク: RPG の定位置欄の DBCS を実機の桁で数える

## タスク
- [x] T1: `dbcs.ts` に実機の桁で切る・置き換える・詰める関数を足し、`buildRpgLineText` と `extractByColumns`、欄の桁あふれの検査で使う。単体テスト・実機のコンパイル。
      対象: `vscode-extension/src/core/dbcs.ts` / `src/prompter/{commandText,initialValues,model}.ts` / `test/unit/prompterRegressions.test.ts` / `verify/`
      依存: なし
      AC: AC1, AC2, AC3
- [x] T2: lint の欄の規則（`requiredField` / `restrictedValue` / `numericField`）を実機の桁で切り、下線の範囲をエディタの列に直す（`fieldRange.ts`・`editorColumnOfMachineColumn`）。単体テスト。
      拡張演算項目 2 の継続記入行を継続として分類する（`preprocess.ts`）。
      対象: `vscode-extension/src/lint/{preprocess,engine}.ts` / `src/lint/rules/{requiredField,restrictedValue,numericField,fieldRange}.ts` / `src/core/dbcs.ts` / `test/unit/lintRules.test.ts`
      依存: T1
      AC: AC4
