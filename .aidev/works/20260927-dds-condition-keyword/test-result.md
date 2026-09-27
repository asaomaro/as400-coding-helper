# テスト結果: 様式・項目のキーワードに条件（標識）を付けられるようにする

- `npm test`: 1473 passing（追加 3 件）。
- GUI e2e（`dev/e2e.mjs`）: 手元で 243 PASS / 0 FAIL（追加 2 件。手元だけで止まる無関係の段は ±1 を許す写しで流した）。

## 受け入れ基準ごとの判定
- AC1: pass — `SFLDSP SFLDSPCTL SFLCLR` の行から `SFLDSP` を移すと、元の行は `SFLDSPCTL SFLCLR`、様式の最後に `     A  31 … SFLDSP`。
  項目の `COLOR(RED) DSPATR(HI)` から `COLOR` を移すと、項目の行は `DSPATR(HI)`、後ろに `     A  40 … COLOR(RED)`。
- AC2: pass — `EDTCDE(1)` は `keyword-not-conditionable` で拒否。
- AC3: pass — `machine-errors.dspf` の CTL01 で `SFLCLR` の「条件」に `33` → `     A  33 … SFLCLR` が書かれ、検証タブの CPD7490 が消える。
- AC4: pass — 実機（SR-OSAKA、IBM i 7.3）で `CONDKW.dspf`（`40 COLOR(RED)`・`31 SFLDSP`・`32 SFLDSPCTL`・`33 SFLCLR`・`34 SFLEND` をこの経路で分けたもの）が `CRTDSPF` 可（#1469）。
