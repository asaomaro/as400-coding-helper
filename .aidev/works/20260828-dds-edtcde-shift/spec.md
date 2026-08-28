# 仕様: `EDTCDE` を書けるキーボード・シフトを種別ごとに正す

## 設計方針

**種別を必須の引数にする。** 任意にすると渡し忘れた側で黙って印刷装置の規則が当たる
（`20260827-dds-edit-type-aware` と同じ判断）。呼び出しは 2 か所しかない。

## 対象範囲

- `src/core/dds/editCode.ts` — `EDITABLE_SHIFTS` と引数
- `src/core/dds/ddsFieldWidth.ts` — `fieldWidth` に種別を通す
- `src/core/dds/dspfLayout.ts` / `prtfLayout.ts` — 渡す

## インターフェース / データ構造

```ts
export type EditedWidthDdsType = "DSPF" | "PRTF";
const EDITABLE_SHIFTS = { DSPF: ["", "S", "Y"], PRTF: ["", "S"] };

export function editedWidth(length, decimals, code, option, dataType, ddsType): EditedWidth;
export function fieldWidth(line, keywords, ddsType): ResolvedWidth;
```

## 振る舞いの詳細

実機の結果をそのまま表にする。`Y` は表示装置だけ。
印刷装置で `Y` が来たら `not-numeric`（幅不明）——**実機が通さない形**なので、
幅を出すと存在しない状態を描くことになる。

## 受け入れ基準との対応

- AC1/AC2/AC3: `EDITABLE_SHIFTS`
- AC4: 必須引数（TypeScript が渡し忘れを弾く）
- AC5: `verify/probe-edtcde-shift.mjs`
