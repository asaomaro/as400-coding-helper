# タスク: キーワード使用レベル検査

- [x] T1: 実機でレベルの規則を確かめる
      対象: `.aidev/works/20260828-dds-keyword-levels/verify/probe-levels.mjs`
- [x] T2: 軽い資源を生成する（依存: T1）
      対象: `docs/origin/generate-dds-keyword-levels.mjs` （新規作成）
- [x] T3: core の判定（依存: T2）
      対象: `vscode-extension/src/core/dds/ddsKeywordLevels.ts` （新規作成）
- [x] T4: 検証済みサンプルで偽陽性を数える（依存: T3）
- [x] T5: 診断とレイアウトへ配線（依存: T4）
      対象: `vscode-extension/src/core/dds/dspfLayout.ts` / `prtfLayout.ts`
- [x] T6: 規則の登録と設定（依存: T5）
      対象: `vscode-extension/src/lint/rules/index.ts` / `types.ts` / `package.json`
- [x] T7: 単体テスト（依存: T5）
      対象: `vscode-extension/test/unit/ddsKeywordLevels.test.ts` （新規作成）
