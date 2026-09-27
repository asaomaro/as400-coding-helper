# テスト結果: キーワードの値をドロップダウン／チェックボックスで選ぶ

- `npm test`: 1562 passing（本件 11 件）。`npm run verify:defs` OK（`generate-dds-keyword-values.mjs --check`: 41 件 × 日英が原典と一致）。
- GUI e2e: DDS 277/277（本件 6 段・D3 の段を値の一覧の無い `TEXT` に置き換え。手元で止まる無関係の段は ±1 を許す写しで流した）、プロンプター 77/77。

## 受け入れ基準ごとの判定
- AC1: pass — 画面 19・物理/論理 10・帳票 12 のキーワードに値の一覧（日英）。画面の COLOR は原典の 7 色、帳票の COLOR は別の 8 色（BLK / BRN あり・WHT なし）、
  画面の CHECK は要約の 16 コード、物理ファイルの DATFMT は 2 表の和 20 形式。値がページ本文に現れること・日英で値が同じことを生成時に検査。
- AC2: pass — `DSPATR` を足すとチェックボックスが出て、RI・HI を選んで「追加」→ `DSPATR(HI RI)`。`COLOR` はドロップダウンで RED → `COLOR(RED)`（GUI）。
  選ばずに「追加」を押すと書かない（`missingKeywordValue`。単体）。
- AC3: pass — `COLOR(RED)` のチップを開くと RED が選ばれており、BLU を選ぶと `COLOR(BLU)`。`DSPATR(HI RI)` の RI を外すと `DSPATR(HI)`（GUI）。
  `DSPATR(&ATTR)`・一覧に無い値は `undefined`（選ばせない）。全部の一覧で「書く → 読む」の往復が一致（単体）。
- AC4: pass — 実機（SR-OSAKA、IBM i 7.3）: 選択が書いた形で組んだ `verify/KWVALD.dspf`（DSPATR / COLOR / CHECK / COMP / EDTCDE / DATFMT / DATE / TIMFMT / TIMSEP / CHGINPDFT）は
  メッセージ 0 件で作成（スプール #1485）、`KWVALF.pf`（CHECK / DATFMT / EDTCDE）も 0 件（#1487）、`KWVALP.prtf`（COLOR / EDTCDE / DATE）は作成でき、
  通知 1 件（CPD8022 重大度 10「DEVTYPE(*SCS) ではキーワードが予定通りに機能しないことがある」。帳票の色は装置依存で、原典どおり）（#1486）。
  対照の `COLOR(PURPLE)` / `DSPATR(ZZ)`（`KWVBAD.dspf`）は CPD7494「このキーワード値を使用することはできない」で作成できない（#1488）。
