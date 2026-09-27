# 設計: 帳票の行送りの様式に行番号を書かない／使用を B にしない

## 方針
- 置く項目の調整は **core の `applyDdsEdits`（`effectiveNewItem`）** に置く。VSCode のホスト・単独起動・CLI が同じ経路を通るので、ホストごとに直さない。
  - 使用の既定はファイルの種類で決める（画面 `B`、帳票は書かない）。ホスト（`editorProvider.askItem` / `dev/standalone.ts`）は使用を送らない。
  - 帳票で様式が行送りを使っていれば `row` を落とす（`NewDspfItem.row` を省略可にし、`buildItemLine` は省略時に行を書かない）。
  - 判定 `recordUsesSpacing`: 様式のキーワードに行送りがある、または様式の項目のどれかが行送りを持つか行番号を持たない。
- 使用の検査 `validateUsage` は追加（`validateAdd`）と属性の書き換え（`validateAttributes`）の両方で使う。
- 検証（`prtfLayout`）の `spacing-with-line-number` は `cursor.recordHasSpacing`（様式の行送り・前の項目の行送り）も見る。
- UI は `model.kind === "prtf"` で使用の選択肢・占有・改名の注記を切り替える。

## 受け入れ基準との対応
- AC1: `effectiveNewItem` / `recordUsesSpacing` / `buildItemLine`。`ddsEdit.test.ts`・`dev/e2e.mjs`（23. 帳票）。
- AC2: `effectiveNewItem`（既定）/ `validateUsage` / `usageSelect`。同上。
- AC3: `prtfLayout.ts` の診断。`prtfLayout.test.ts`。
- AC4: `ui.ts` の占有・注記。`dev/e2e.mjs`。
- AC5: `verify/make-add.mjs` → `ADDP.prtf`、対照 `SPROW` / `FLDSPROW` / `USEB`（と `SPCOL` / `USEO`）。

## 依拠する事実（実機・2026-09-27）
- 様式 `SPACEB(1)` ＋項目の行番号 → CPD7860（`SPROW`）。桁だけなら作成可（`SPCOL`）。
- 前の項目が `SPACEB(1)`、次の項目に行番号 → CPD7802「行番号またはプラス値を使用することはできない」（`FLDSPROW`）。
- 帳票のフィールドの使用 `B` → CPD7410（`USEB`）。`O` は作成可（`USEO`）。
