# タスク: F 仕様 継続行の選択欄・記入欄を足す

- [x] T1: `CONTOPT`(54-59) / `CONTENTRY`(60-65) を定義に足す（実機で確かめた 15 語を help に）
      対象: `vscode-extension/resources/prompter/rpg/rpg3/ja/F-SPEC.json`（`CONTINUATION` と `FILEADD` の間）/ 根拠: research A1
- [x] T2: `CONTINUATION` の `placeholder` を `S` → `K` に直す
      対象: 同上 / 根拠: help に「K か空白しか入らない」とある（現状の誤り）
- [x] T3: 桁が重ならないことをテストで固定する（依存: T1）
      対象: `vscode-extension/test/unit/rpg3NumericColumns.test.ts`
- [x] T4: 条件表示（`CONTINUATION=K` のときだけ出る）をテストで固定する（依存: T1）
      対象: 同上 / 根拠: research A3
- [x] T5: `npm test` / `npm run verify` を通す（依存: T3, T4）
      対象: 未特定（実行のみ）
