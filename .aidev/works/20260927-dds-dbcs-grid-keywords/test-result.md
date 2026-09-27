# テスト結果: 画面の罫線キーワード（GRD*）を辞書に入れる

- `npm test`: 1478 passing（追加 2 件）。辞書を戻すと 1 件落ちる（もう 1 件は「指摘が出ない」側で、未知のキーワードは元から咎めないため戻しても通る）。
- `verify-dds-keywords.mjs`（DBCS の索引も突き合わせる）・`verify-dds-conditioning.mjs`・`verify:defs`: OK。

## 受け入れ基準ごとの判定
- AC1: pass — 生成物の差分は DSPF に 7 キーワードが増えただけ（既存のキーワードの変更 0 件、日英とも）。
  レベル: GRDATR = file/record、GRDBOX / GRDCLR / GRDLIN / GRDRCD = record、IGCALTTYP = field、IGCCNV = file。GRDRCD は条件不可、他は条件可。
- AC2: pass — `GRDRCD` / `GRDATR` / `GRDBOX` / `GRDLIN` を書いた画面の診断 0 件。`v3/CMPLXD.dspf` も 0 件。
