# テスト結果: キーワードを `-` で切るとき語の途中で切らない

- `npm test`: 1460 passing（追加 1 件）。切り目を戻すと追加の 1 件が落ちる（確認済み）。

## 受け入れ基準ごとの判定
- AC1: pass — `WDWTITLE((*TEXT '顧客詳細')-` / ` (*COLOR WHT))` に折れ、読み直すと元の値。
- AC2: pass — 空白の無い値・DBCS の長い定数の既存テスト（`20260926-dds-fold-long-constant` を含む）が通る。
  実機（SR-OSAKA、IBM i 7.3）で `verify/WDWFOLD.dspf` が `CRTDSPF` 可（#1462）。
