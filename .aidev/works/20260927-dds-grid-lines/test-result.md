# テスト結果: 画面の罫線（GRDBOX / GRDLIN）を描く

- `npm test`: 1530 passing（本件 8 件）。GUI e2e 259 PASS / 0 FAIL（本件 2 件）。

## 受け入れ基準ごとの判定
- AC1: pass — 幅 21・罫線 3 の VRT で内側の縦線 6 本（原典の記述どおり）。GUI で `GRDBOX((*POS (3 2 3 30)))` が 4 本の線になり、上辺は 3 行目の上の境目・2 桁目の左の境目から 30 桁。
- AC2: pass — 原典の例の `RIGHT 4 15`（桁 6・21・36・51、長さ 20）・`LOWER 3 6`（行 8・14・20）と一致。`*TYPE` 省略は UPPER。
- AC3: pass — 原典 `GRDATR` の例（GRDREC1 は青の破線、GRDREC2 の箱は白の実線、GRDLIN は赤の二重線）と一致。`&SROW` 等の位置は描かない。条件 95 はオフで消える。
- 実機: 罫線は DBCS 装置（原典「グリッド・ライン・サポートには、DBCS 装置が必須」）でしか出ず、手元の 5250（ts5250）は描かないため画面での突き合わせはしていない。`CRTDSPF` が GRDBOX の様式を受け付けることは `v3/CMPLXD.dspf` で確認済み（findings.md の D19）。
