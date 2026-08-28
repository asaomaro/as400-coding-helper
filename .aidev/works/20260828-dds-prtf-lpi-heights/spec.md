# 仕様: 行の高さを LPI で決める

## 設計方針

`PlacedItem` に **その行の LPI** を持たせ、紙の比率のときだけ
**位置（インチ）と行の高さ**で置く。升目のときは今までどおり `行番号 × --cell-h`。

**`inches` は原典の数え方**で「その行を印刷し終えた位置」
（原典: 行番号 48 へのスキップは「48/6 = 8 インチ分スキップしてから印刷」）。
描くのに要るのは**行の上端**なので、1 行分だけ戻す。

## 対象範囲

- `src/core/dds/prtfLayout.ts` — `PlacedItem.lpi`
- `src/core/dds/ddsRenderItem.ts` — `inches` / `lpi` を運ぶ
- `src/dds/webview/ui.ts` — 紙の比率での配置

## 受け入れ基準との対応

- AC1: `cursor.lpi` を項目に写す。様式ごとに入れ直す（前 work で実装済み）。
- AC2: `top = inches × 96 × 倍率 − 行の高さ`、`height = 96 × 倍率 ÷ lpi`。
- AC3: LPI が 1 つなら `inches = (行番号 − 1) ÷ lpi + 1 ÷ lpi` なので同じ位置になる。
- AC4: `previewDensity()` が無ければ従来の経路。
