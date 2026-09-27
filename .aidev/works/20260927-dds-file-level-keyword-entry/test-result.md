# テスト結果: ファイル・レベルのキーワードを 1 つ目から足せるようにする

- `npm test`: 1466 passing（追加 6 件）。
- GUI e2e（`dev/e2e.mjs`）: 手元で 241 PASS / 0 FAIL（追加 6 件。手元だけで止まる無関係の段は ±1 を許す写しで流した）。
  既存の「候補から足したキーワードがファイル・レベルの行に入る」（`PRINT`）は、括弧ごと省略できるので名前だけで入るようになった（以前は `PRINT()`）。

## 受け入れ基準ごとの判定
- AC1: pass — 新しい帳票で「ファイル（キーワードなし・ここから足す）」が出て、`INDARA` を足すと最初の様式の前に入り、その行が選ばれる。
- AC2: pass — 様式に `DSPSIZ` を足そうとすると書かず「DSPSIZ は様式には書けません（書ける場所: ファイル）」。core も帳票の `LPI` / DSPF の `OVERLAY` のファイル・レベルを拒否。
- AC3: pass — 項目に `COLOR` を足すとソースは変わらず、生テキストの欄が `… COLOR()` で焦点がある。`COLOR(RED)` にして Enter で書かれる。
  `PRINT` / `CAnn` / `SFLEND` / `INDARA` / `OVERLAY` は括弧不要、`DSPSIZ` / `COLOR` / `CHECK` は必須と判定。
- AC4: pass — `DSPSIZ()`（ファイル・レベル）・`COLOR()`（項目）を指摘。
- AC5: pass — 実機（SR-OSAKA、IBM i 7.3）で `ADDFILE.prtf`（足す経路で作成）は `CRTPRTF` 可（#1467）。
  対照: `EMPTYP.dspf`（`DSPSIZ()`）CPD7498 / CPD7512、`RECLVL.dspf`（様式に `DSPSIZ`）CPD7486、`FLPI.prtf` / `FCPI.prtf`（ファイル・レベルの `LPI` / `CPI`）CPD7486。
