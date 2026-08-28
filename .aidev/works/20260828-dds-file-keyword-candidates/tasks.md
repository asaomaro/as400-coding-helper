# タスク: ファイル・レベルのキーワードの候補

- [x] T1: `keywordsForLevel` / `KeywordLevel` を core に足す
      対象: `vscode-extension/src/core/dds/ddsKeywords.ts:158`
- [x] T2: `＋` の塞ぎを外し、絞りを core に委ねる（依存: T1）
      対象: `vscode-extension/src/dds/webview/ui.ts:1153` `keywordSection`
- [x] T3: 単体テスト（依存: T1）
      対象: `vscode-extension/test/unit/ddsFileKeywords.test.ts`
- [x] T4: e2e（依存: T2）
      対象: `vscode-extension/dev/e2e.mjs`
