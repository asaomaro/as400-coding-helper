# テスト結果: キーワード欄の書き換えで条件つきの行を平らにしない／様式の条件つきの行を出す

- `npm test`: 1476 passing（追加 3 件）。書き分けを無効にすると 2 件落ちる（確認済み）。既存の「欄をまるごと置き換える（後ろのキーワード行ごと）」等は通る。
- GUI e2e（`dev/e2e.mjs`）: 手元で 244 PASS / 0 FAIL（追加 1 件）。

## 受け入れ基準ごとの判定
- AC1: pass — `DSPATR(HI)` ＋ `40 COLOR(RED)` の項目に `CHECK(ER)` を足すと、代表行 `DSPATR(HI) CHECK(ER)`、`40 COLOR(RED)` の行はそのまま。
- AC2: pass — `COLOR(RED)` を外すと `40` の行ごと消える。`DSPATR(HI)` を外すと代表行の欄が空になり `40 COLOR(RED)` は残る。
- AC3: pass — 既存テスト全件。
- AC4: pass — CTL01 のプロパティに `SFLDSP=31`・`SFLCLR=33` の行が出る。
