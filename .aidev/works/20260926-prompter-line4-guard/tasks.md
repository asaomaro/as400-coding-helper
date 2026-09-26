# タスク: RPG ソースの 4 行目にもプロンプターの値を書き戻す

## 作業順序と依存関係
T1（純粋関数と単体テスト）→ T2（書き戻しで使う）。

## テスト方針
`npm test`。足したテストは実装を外すと落ちることを確かめる。

## タスク
- [x] T1: `commandText.ts` に `narrowToEditableColumns(original, updated, protectedColumns)` を足し、単体テスト（1〜6 桁目が同じなら 7 桁目以降の範囲と文字列、違えば不可、元の行が 6 桁未満）。
      対象: `vscode-extension/src/prompter/commandText.ts` / `vscode-extension/test/unit/prompterRegressions.test.ts`
      依存: なし
      AC: AC1, AC2
- [x] T2: `applyChanges.ts` の RPG の分岐で、`isEditAllowedRange` が false のとき T1 で範囲を狭めて書く。狭められなければ通知して書かない。
      対象: `vscode-extension/src/prompter/applyChanges.ts:56-75`
      依存: T1
      AC: AC1, AC2, AC3
