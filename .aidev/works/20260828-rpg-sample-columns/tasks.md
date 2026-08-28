# タスク: サンプルの桁を直す

- [x] T1: 実機に判定させる
      対象: `.aidev/works/20260828-rpg-sample-columns/verify/probe-dspec.mjs`
- [x] T2: サンプルの DS 下位フィールドを直す（依存: T1）
      対象: `docs/src/EMPMNT01.rpgle` / `docs/src/SLSENT01.rpgle`
- [x] T3: 残った指摘（`DOU`）を調べる（依存: T2）
- [x] T4: 拡張演算項目 2 の命令を原典から採る（依存: T3）
      対象: `vscode-extension/src/core/rpgSpec.ts:23`
- [x] T5: 既存テストの寄りかかりを外す（依存: T2）
      対象: `vscode-extension/test/unit/lintCorpus.test.ts` / `lintDiagnostics.test.ts`
- [x] T6: `CHECKLIST.md` と CI（依存: T2, T4）
      対象: `docs/src/CHECKLIST.md` / `.github/workflows/prompter-definitions.yml`
- [x] T7: 直した形が実機で通ることを確かめる（依存: T2）
      対象: `.aidev/works/20260828-rpg-sample-columns/verify/verify-dspec-fix.mjs`
