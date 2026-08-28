# タスク: RPG の注記行のガード

- [x] T1: `isCommentLine` と 2 か所のガード
      対象: `vscode-extension/src/core/rpgSpec.ts:107` `absorb` / `:134` `classifyWithState`
- [x] T2: `ruler.ts` の写しを外す（依存: T1）
      対象: `vscode-extension/src/language/ruler.ts:573`
- [x] T3: 単体テスト（依存: T1）
      対象: `vscode-extension/test/unit/rpgSpecContext.test.ts`
