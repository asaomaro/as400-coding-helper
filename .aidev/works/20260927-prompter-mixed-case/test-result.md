# テスト結果: 英大文字だけに縛っている欄を実機に合わせる

- `npm test`: 1448 passing（追加 3 件）。定義を戻すと 2 件落ちる（確認済み。DDS の名前欄の件は変わらないので落ちない）。
- `npm run verify:defs`: pass。生成物の差分は `characterSet` の 1 行ずつだけ（DDS ja/en 6 件、ILE ja/en 6 件）。

## 受け入れ基準ごとの判定
- AC1: pass — `'Search: customer name'`・`'顧客名で絞り込みます'` にエラーなし。DDS の名前 `fld` はエラーのまま。
- AC2: pass — `loadSubfile`（D・P）、`mixcased`（F）にエラーなし。
- AC3: pass — 実機（SR-OSAKA、IBM i 7.3）で `MIXCASED.dspf`（小文字・DBCS の定数）は `CRTDSPF` 可（#1454）、`MIXCASE.rpgle`（`loadSubfile` / `rowCount` / `mixcased`）は
  `CRTBNDRPG` 可（#1456。1 回目は見本に `DFTACTGRP(*NO)` が無く RNF3788。見本の誤り）。
