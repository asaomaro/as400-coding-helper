# タスク: プレビューとビジュアルエディタの使い分けを案内する

- [x] T1: `verify-contributes.mjs` に「エディタの右クリック導線」検査を足す
      対象: `docs/origin/verify-contributes.mjs:127` `PREVIEW_MENUS`
- [x] T2: T1 が**現状で落ちる**ことを確かめる（導線が無いので落ちるはず）
      対象: 同上
- [x] T3: `openDdsVisualEditor` コマンドを登録する（依存: なし）
      対象: `vscode-extension/src/dds/editorProvider.ts:51` `registerDdsVisualEditor`
- [x] T4: `package.json` に `commands` / `menus` を足し、3 つの `title` を直す（依存: T3）
      対象: `vscode-extension/package.json:73` `commands` / `:120` `menus`
- [x] T5: 使い分けの文書を書く
      対象: `docs/dds-editor-and-preview.md`（新規）
- [x] T6: `npm run verify` / `npm test` / lint の回帰
      対象: 未特定
