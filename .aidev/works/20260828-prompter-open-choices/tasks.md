# タスク: 候補にすぎない選択欄を、一覧つき自由入力にする

- [x] T1: `SerializableField.restricted` を足し、`toSerializableState` で詰める
      対象: `vscode-extension/src/prompter/formModel.ts`（`maxLength` の隣）/ 根拠: research A3
- [x] T2: `buildControl` を分け、欄ごとの `<datalist>` を作る（依存: T1）
      対象: `vscode-extension/src/prompter/webview/ui.ts` `buildControl` / 根拠: research A1, A2
- [x] T3: ハーネスに `ADDPFM` を足す（`SRCTYPE` が該当欄）（依存: T2）
      対象: `vscode-extension/dev/prompter-standalone.ts` の `SAMPLES`
- [x] T4: e2e で「一覧に無い値を打って確定できる」「候補が並ぶ」「制限ありは select のまま」（依存: T3）
      対象: `vscode-extension/dev/prompter-e2e.mjs`
- [x] T5: 単体テストで載せる範囲を固定（依存: T1）
      対象: `vscode-extension/test/unit/prompterWebview.test.ts`
- [x] T6: 全部回して、後退を戻すと落ちることを確かめる（依存: T4, T5）
      対象: 未特定（実行のみ）
