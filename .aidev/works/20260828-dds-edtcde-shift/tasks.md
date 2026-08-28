# タスク: `EDTCDE` を書けるキーボード・シフトを種別ごとに正す

- [x] T1: 実機で確かめる
      対象: `.aidev/works/20260828-dds-edtcde-shift/verify/probe-edtcde-shift.mjs`
- [x] T2: `editedWidth` を種別つきに（依存: T1）
      対象: `src/core/dds/editCode.ts` `EDITABLE_SHIFTS`
- [x] T3: `fieldWidth` と呼び出し（依存: T2）
      対象: `src/core/dds/ddsFieldWidth.ts` / `dspfLayout.ts` / `prtfLayout.ts`
- [x] T4: テスト（依存: T3）
      対象: `test/unit/ddsEditCode.test.ts`
