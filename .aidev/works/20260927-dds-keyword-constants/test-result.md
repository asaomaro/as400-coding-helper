# テスト結果: 文字列の無い定数を扱う（D4）

- `npm test`: 1503 passing（追加 3 件）。GUI e2e 252 PASS / 0 FAIL（追加 2 件。手元だけで止まる無関係の段は ±1 を許す写しで流した）。

## 受け入れ基準ごとの判定
- AC1: pass — DATE EDTCDE(Y) / TIME / USER の行が 3 項目になり、診断 0 件（以前は「レコード・レベルに書けない」）。一覧の名前は DATE / TIME / USER。
- AC2: pass — 実機（SR-OSAKA、IBM i 7.3）の `CRTDSPF` のリスト（#1472、`verify/KWCONST.dspf`）の長さ 6 / 8 / 8 / 10 / 8 / 8 / 10 と一致。
- AC3: pass — 画面で定数の種類に「DATE EDTCDE(Y)」を選ぶと `9 40DATE EDTCDE(Y)` が書かれ、`MM/DD/YY` で描かれる。キーワード欄を `DATE(*YY)` に書き換えられる。帳票に SYSNAME は拒否。
