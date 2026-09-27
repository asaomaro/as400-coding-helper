# テスト結果: 1 行に収まらない定数を継続行に分けて書く

- `npm test`: 1415 passing / 0 failing（追加 5 件: 継続行 3・DBCS 判定 2）。
  `ddsEdit.ts`（`buildItemLines` を使わない）・`dspfOutline.ts`（代表行だけ読む）・`dbcs.ts`（変換表を引かない）の
  どれを戻しても追加したテストが落ちる（確認済み）。
- `npm run verify:defs`: pass（`generate-dbcs-table.mjs --check` を含む）。

## 受け入れ基準ごとの判定
- AC1: pass — 半角 80 文字・全角 38 文字の定数が代表行＋`-` の継続行に分かれ、各行が実機の桁で 80 桁以内（`printWidth`）。
- AC2: pass — 置いたソースを読み直すと元の文字列の 1 定数になり、後続の様式は変わらない。アウトラインの表示名も元の文字列。
- AC3: pass — 実機（SR-OSAKA、IBM i 7.3、ASAOLIB、ソース・ファイル QDDSJ CCSID 5035）で確認。
  - `CRTDSPF FOLDD` 作成可（リスト #1412、誤りなし）。`CRTPRTF FOLDP` 作成可（リスト #1414、誤りなし）。
  - 5250 で `CALL FOLDR`: 3 行目に `-` 80 個、5 行目に `─` 38 個が切れずに出る（`verify/fold-dspf.png`）。
  - `CALL FOLDPR`: スプール FOLDP #1417 に `-` 80 個と `─` 38 個の行。
  - 1 回目は `─` が 17＋4 個に切れた（罫線を 1 桁と数えて折っていた）。DBCS 判定を変換表から引くよう直して再確認した。
- AC4: pass — 36 桁以内の定数は 1 行のまま（既存テスト全件）。

スプールは消していない（QPRTJOB の FOLDD #1412・FOLDP #1413/#1414・FOLDR #1415・FOLDPR #1416・FOLDP #1417 ほか 1 回目の分）。
