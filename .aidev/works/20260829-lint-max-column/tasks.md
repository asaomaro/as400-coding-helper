# タスク: lint の桁上限を設定化する

- [x] T1: `DEFAULT_MAX_COLUMN` / `MIN_MAX_COLUMN`(1) / `MAX_MAX_COLUMN`(32754) と
      `resolveMaxColumn(value: unknown): number`（不正なら既定）を置き、`rules/index.ts` から re-export する。
      この段では規則の振る舞いを変えない
      対象: `vscode-extension/src/lint/rules/lineLength.ts:25` `MAX_COLUMN` /
      `vscode-extension/src/lint/rules/index.ts:1` / 根拠: research A1, spec「インターフェース」
- [x] T2: `LintOptions.maxColumn?`（任意）と `RuleContext.maxColumn`（**必須**）を足し、
      `engine.ts` で `request.options?.maxColumn ?? DEFAULT_MAX_COLUMN` を解決して
      行ごとの `RuleContext` に載せる（依存: T1）
      対象: `vscode-extension/src/lint/types.ts:111` `LintOptions` /
      `vscode-extension/src/lint/types.ts:121` `RuleContext` /
      `vscode-extension/src/lint/engine.ts:76` `const context = {…}` / 根拠: research A2, A3
- [x] T3: 規則本体を `context.maxColumn` に切り替える。**判定・下線・メッセージ後半の 3 か所を同時に**直す。
      メッセージ後半は `L>=100` / `81<=L<=99` / `L<=80` の 3 分岐（`L>=100` は現在と文字列同一）（依存: T2）
      対象: `vscode-extension/src/lint/rules/lineLength.ts:29,35,44,45` / 根拠: research A1, spec「設計方針 4」
- [x] T4: 規則の単体テストを足す。上限 80 で 81 桁が指摘・80 桁ちょうどは通る・メッセージに適用中の上限が出る・
      全角を含む行が `printWidth` で判定される。**T3 を戻すと落ちること**を確認する（依存: T3）
      対象: `vscode-extension/test/unit/lintRules.test.ts` / 根拠: research A7, plan「テスト方針」
- [x] T5: `rpgClSupport.lint.maxColumn` を宣言する（`integer` / 既定 100 / `minimum` 1 / `maximum` 32754）。
      説明にデータ桁 = レコード長 − 12 と代表値（112→100 / 92→80）、CI では `--max-column` に同じ値を渡すことを書く
      対象: `vscode-extension/package.json` `contributes.configuration.properties`
      （`rpgClSupport.lint.enable` の隣）/ 根拠: research A6, F3
- [x] T6: エディタ側で設定を読み `options.maxColumn` に渡す。**不正値は既定にフォールバック**（依存: T2, T5）
      対象: `vscode-extension/src/language/lintDiagnostics.ts:82` `options: {…}` /
      `:16` `CONFIG_SECTION` / 根拠: research A4, spec「設計方針 3」
- [x] T7: エディタのテストを足す。`setConfig({ rpgClSupport: { "lint.maxColumn": 80 } })` が効くこと、
      不正値（`0` / `1.5` / 文字列）で既定 100 に戻ること（依存: T6）
      対象: `vscode-extension/test/unit/lintDiagnostics.test.ts:94` `setConfig` / 根拠: research A7, F5
- [x] T8: CLI に `--max-column <桁数>` を足す。**不正値・範囲外は `UsageError`**。
      `USAGE` に、VSCode 設定と同じ値を渡すべきこと（食い違いの警告）を `--c-new-opcode` と同じ調子で書く（依存: T2）
      対象: `vscode-extension/src/cli/lint.ts:22` `USAGE` / `:100` `case "--c-new-opcode"` /
      `:190` `options: {…}` / 根拠: research A5, F5
- [x] T9: CLI のテストを足す。`--max-column 80` が規則単体と同じ指摘を出すこと（AC4）、
      不正値・範囲外・値なしが `UsageError` になること（依存: T8）
      対象: `vscode-extension/test/unit/lintCli.test.ts` / 根拠: research A7
- [x] T10: 通し確認。**`rm -rf out out-test` してから** `npm run compile` → `npm test` →
      `node scripts/verify-lint-core.mjs`。既存テストが 1 件も変わらず通ること（AC5）と、
      テスト件数が水増しされていないことを見る（依存: T4, T7, T9）
      対象: `vscode-extension/` （コマンド実行）/ 根拠: AGENTS.md「テストの走らせ方」, research F6
