# タスク: 検証を実機の誤りに揃える

## タスク
- [x] T1: 条件が必須のキーワードを原典から生成し、実機の 3 件と照合する。
      対象: `docs/origin/generate-dds-conditioning.mjs` / `docs/origin/verify-dds-conditioning.mjs` / `resources/completion/dds-conditioning.json` / `src/core/dds/ddsConditionable.ts`
      依存: なし
      AC: AC1
- [x] T2: `ddsSourceDiagnostics` を作り、画面・帳票の layout から呼ぶ。単体テスト。
      対象: `src/core/dds/{ddsSourceDiagnostics,dspfLayout,prtfLayout}.ts` / `test/unit/ddsSourceDiagnostics.test.ts`
      依存: T1
      AC: AC1, AC2, AC3, AC4
- [x] T3: lint の規則と設定・検証タブの e2e。
      対象: `src/lint/{types.ts,rules/index.ts,rules/layout.ts}` / `package.json` / `test/unit/lintRules.test.ts` / `dev/{standalone.ts,e2e.mjs}`
      依存: T2
      AC: AC5
- [x] T4: 偽陽性の確認（リポジトリ内の DDS 全件）と実機の対照。
      対象: `verify/`
      依存: T2
      AC: AC6
