# テスト結果: CL は利用者が入れたものだけ書く（P16）

- `npm test`: 1483 passing（追加 3 件）。省く扱いを無効にすると 2 件落ちる（確認済み）。
- `verify-cl-roundtrip.mjs`（原典の使用例 223 定義）・`verify-prompter-roundtrip.mjs`（538 定義）: OK。
- `dev/prompter-e2e.mjs`: 76/76 PASS。書き戻しの期待 2 件を `MSGF(QCPFMSG)` / `PGM(MYPGM)` に更新した（決定どおりの変更）。

## 受け入れ基準ごとの判定
- AC1: pass — `PGM(CMPLXPR)`・`PGM(MYLIB/CMPLXPR)`・`PAGESIZE(66 132)`・`PAGESIZE(66 132 *UOM)`。
- AC2: pass — 元のソースに `PGM` があれば `PGM(*LIBL/CMPLXPR)` のまま。往復検証 OK。
- AC3: pass — 実機（SR-OSAKA、IBM i 7.3）で `verify/CLDFT.clle`（`OVRPRTF FILE(CMPLXP) PAGESIZE(66 132)` / `CALL PGM(CMPLXPR)`）が `CRTBNDCL` 可（#1470）。
