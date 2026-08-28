# タスク: 画面サイズ条件名の桁を実機に合わせる

- [x] T1: 実機で桁を確かめる
      対象: `.aidev/works/20260828-dds-screen-size-column/verify/probe-screen-size-column.mjs`
- [x] T2: 書き出す桁を 9 に（依存: T1）
      対象: `src/core/dds/ddsConditionWriteBack.ts` `formatScreenSizeArea`
- [x] T3: 読む側で 7 桁目も拾う（依存: T1）
      対象: `src/core/dds/ddsConditioning.ts` `readConditioning`
- [x] T4: テストと e2e（依存: T2, T3）
      対象: `test/unit/ddsConditionEdit.test.ts` / `dev/e2e.mjs`
