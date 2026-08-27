# タスク: 描画全体を実機のゴールデンと突き合わせる

- [x] T1: 検査用の様式 `RENDER1.dspf` を生成する（DBCS / 混在 / 用途 3 種 / 属性 / 条件付き）
      対象: `vscode-extension/test/golden/RENDER1.dspf`（新規）
- [x] T2: 採取スクリプトを書く（依存: T1）
      対象: `.aidev/works/20260827-dds-render-golden/verify/capture-render-golden.mjs`（新規）/
      先例: `.aidev/works/20260827-dds-5250-colors/verify/verify-attributes.mjs`
- [x] T3: 実機で採る（依存: T2）
      対象: `vscode-extension/test/golden/RENDER1.screen.json`（新規）
- [x] T4: 照合テスト（検査 1-4）を書く（依存: T3）
      対象: `vscode-extension/test/unit/ddsRenderGolden.test.ts`（新規）
- [x] T5: 落ちることを確かめる（依存: T4）
      対象: `vscode-extension/src/core/dds/ddsRenderItem.ts` `constantSegments`
- [x] T6: 回帰（`npm test` / `npm run verify` / e2e）
      対象: 未特定
