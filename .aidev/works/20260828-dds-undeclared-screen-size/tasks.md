# タスク: 使えない画面サイズ条件名を知らせる

- [x] T1: 実機で規則を確かめる（8 通り）
      対象: `.aidev/works/20260828-dds-undeclared-screen-size/verify/`
- [x] T2: 指摘（依存: T1）
      対象: `src/core/dds/dspfLayout.ts` `undeclaredScreenSizeDiagnostics`
- [x] T3: lint 規則（依存: T2）
      対象: `src/lint/types.ts` / `rules/index.ts` / `rules/layout.ts` / `package.json`
- [x] T4: テスト（依存: T3）
      対象: `test/unit/ddsConditionable.test.ts` / `test/unit/dspfLayout.test.ts` / `lintRules.test.ts`
