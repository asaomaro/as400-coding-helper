# タスク: RPG III の数値欄

- [x] T1: 実機で C 仕様の数値欄を確かめる
      対象: `.aidev/works/20260828-rpg3-numeric-columns/verify/probe-rpg3-numeric.mjs`
- [x] T2: 実機で I 仕様の数値欄を確かめる（依存: T1）
      対象: `.aidev/works/20260828-rpg3-numeric-columns/verify/probe-rpg3-io.mjs`
- [x] T3: 定義に `numericOnly`（依存: T1, T2）
      対象: `vscode-extension/resources/prompter/rpg/rpg3/ja/{C,I}-SPEC.json`
- [x] T4: サンプルに何が出るかを見る（依存: T3）
- [x] T5: 行末の扱いを直す（依存: T4）
      対象: `vscode-extension/src/lint/rules/numericField.ts:88`
- [x] T6: サンプルを直し、実機で確かめる（依存: T5）
      対象: `docs/src/RPG3SAMP.rpg` / `verify/verify-rpg3-fix.mjs`
- [x] T7: 単体テスト（依存: T5, T6）
      対象: `vscode-extension/test/unit/rpg3NumericColumns.test.ts` （新規作成）
