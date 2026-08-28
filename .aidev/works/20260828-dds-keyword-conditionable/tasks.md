# タスク: 条件付けできないキーワードを知らせる

- [x] T1: 原典の言い回しを数える
      対象: `docs/origin/dds/detail/*.htm`（287 ページ）
- [x] T2: 生成器（依存: T1）
      対象: `docs/origin/generate-dds-conditioning.mjs`（新規）
- [x] T3: 検査（依存: T2）
      対象: `docs/origin/verify-dds-conditioning.mjs`（新規）
- [x] T4: 表の引き方（依存: T2）
      対象: `vscode-extension/src/core/dds/ddsConditionable.ts`（新規）
- [x] T5: 指摘（依存: T4）
      対象: `src/core/dds/dspfLayout.ts` / `src/core/dds/prtfLayout.ts` `unconditionableDiagnostics`
- [x] T6: lint 規則（依存: T5）
      対象: `src/lint/types.ts` / `src/lint/rules/index.ts` / `src/lint/rules/layout.ts` / `package.json`
- [x] T7: テストと回帰（依存: T6）
      対象: `test/unit/ddsConditionable.test.ts`（新規）/ `test/unit/lintRules.test.ts`
