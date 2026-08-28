# タスク: 継続行にまたがる参照

- [x] T1: 走査を `joinContinuations` に変え、run の長さで分岐する
      対象: `vscode-extension/src/core/dds/ddsEdit.ts` `renameReferenceResults` / 根拠: research A1
- [x] T2: 単体テスト（依存: T1）
      対象: `vscode-extension/test/unit/ddsRenameReferences.test.ts`
- [x] T3: e2e（サンプルに継続を入れる）（依存: T1）
      対象: `vscode-extension/dev/standalone.ts` / `dev/e2e.mjs`
- [x] T4: 実機で折り直した結果を確かめる（依存: T1）
      対象: `.aidev/works/20260828-dds-continued-references/verify/verify-continued-rename.mjs`
