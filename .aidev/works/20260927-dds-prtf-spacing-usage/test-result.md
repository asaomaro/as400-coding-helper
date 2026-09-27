# テスト結果: 帳票の行送りの様式に行番号を書かない／使用を B にしない

- `npm test`: 1433 passing（追加 6 件）。`effectiveNewItem`・`validateUsage` を戻すと 3 件、診断を戻すと 2 件落ちる（確認済み）。
- GUI e2e（`dev/e2e.mjs`）: 手元で 231 PASS / 0 FAIL（追加 3 件）。手元だけで止まる無関係の段（2 次画面のドラッグ行）は ±1 を許す写しで流した（PR #184 と同じ事情）。

## 受け入れ基準ごとの判定
- AC1: pass — `SKIPB(3)` の様式に置いた定数は 39-44 桁が `    40`、行番号の様式は ` 12  5`。GUI でも HEADING に置いた `'PAGE'` の 39-41 桁が空。
- AC2: pass — 帳票のフィールドは 38 桁が空、画面は `B`。`B`・`H` は拒否、`O`・`P` は通る。プロパティの選択肢は `["", "O", "P"]`。
- AC3: pass — 様式 `SKIPB(3)`＋行番号、前の項目 `SPACEB(1)`＋行番号の両方を指摘。
- AC4: pass — 帳票のプロパティに「属性文字」「CSRLOC」が出ない。
- AC5: pass — 実機（SR-OSAKA、IBM i 7.3）。`ADDP.prtf`（置く経路で作成）は `CRTPRTF` 可（#1437）。
  対照: `SPROW` CPD7860（#1426）/ `FLDSPROW` CPD7802（#1432）/ `USEB` CPD7410（#1429）。`SPCOL`（#1427）・`USEO`（#1430）は作成可。

スプールは消していない（QPRTJOB）。作ったファイル（ASAOLIB の SPROW / SPCOL / USEO / ADDP ほか）も消していない。
