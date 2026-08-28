# タスク: 編集の検証に DDS の種別を渡す

- [x] T1: `EditableDdsType` と必須引数
      対象: `vscode-extension/src/core/dds/ddsEdit.ts:145` `validateDdsEdits` / `:215` `applyDdsEdits`
- [x] T2: 呼び出し元 3 か所（依存: T1）
      対象: `src/dds/editorProvider.ts` / `src/cli/dds.ts` / `dev/standalone.ts`
- [x] T3: 単体テスト 7 ファイル（依存: T1）
      対象: `test/unit/dds*.test.ts`
- [x] T4: 1 桁目の検査（依存: T1）
      対象: `src/core/dds/ddsEdit.ts` `validatePosition` の周辺
- [x] T5: 行送りを帳票だけに（依存: T1）
      対象: `src/core/dds/ddsEdit.ts:387` `validateRowMove`
- [x] T6: テストを足す（依存: T4, T5）
      対象: `test/unit/ddsEditTypeAware.test.ts`（新規）
- [x] T7: 回帰
      対象: 未特定
