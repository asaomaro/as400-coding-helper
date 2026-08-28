# タスク: 画面サイズの「位置の上書き行」を配置に反映する

- [x] T1: 実機で条件名が書ける行の形を洗う
      対象: `.aidev/works/20260828-dds-alternate-position/verify/probe-screen-size-forms.mjs`
- [x] T2: 分類と付け替え（依存: T1）
      対象: `src/core/dds/ddsLogicalUnits.ts` `classifyDdsLine` / `toLogicalUnits`
- [x] T3: 2 次で解く（依存: T2）
      対象: `src/core/dds/dspfLayout.ts` `DspfLayoutOptions`
- [x] T4: モデルと CLI（依存: T3）
      対象: `src/core/dds/dspfRenderModel.ts` `secondaryScreen` / `src/cli/dds.ts`
- [x] T5: 切替とドラッグ禁止（依存: T4）
      対象: `src/dds/webview/ui.ts` `screenModel` / `onPointerDown`
- [x] T6: サンプルとテスト・e2e（依存: T5）
      対象: `dev/standalone.ts` / `test/unit/dspfLayout.test.ts` / `dev/e2e.mjs`
