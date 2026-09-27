# テスト結果: H 仕様書を書き戻す・読み込む

- `npm test`: 1470 passing（追加 4 件）。書き戻しの分岐を外すと 3 件落ちる（確認済み）。全定義の往復 OK。

## 受け入れ基準ごとの判定
- AC1: pass — `DFTACTGRP=*NO, ACTGRP=*NEW, DATFMT=*ISO` → `     H DATFMT(*ISO) DFTACTGRP(*NO) ACTGRP(*NEW)`（定義の欄の順）。
- AC2: pass — `DFTACTGRP(*NO) NOMAIN ACTGRP('QILE') BNDDIR('A':'B')` から 3 欄を読み、`NOMAIN` は残る。無変更の確定で元の行のまま。
- AC3: pass — 80 桁を超えると `     H …` の 2 行目に続く。実機（SR-OSAKA、IBM i 7.3）で書き戻しから組んだ 2 行の H 仕様書を含む `verify/HSPEC.rpgle` が `CRTBNDRPG` 可（#1468）。
- AC4: pass — 本物の VS Code（`docs/research/20260927-f4-prompter-exploration/driver.mjs`）で `     H DFTACTGRP(*NO) NOMAIN` の行を F4 → `DFTACTGRP=*NO` が読まれ、
  ACTGRP・DATFMT を入れて OK → `     H DFTACTGRP(*NO) NOMAIN DATFMT(*ISO) ACTGRP(*NEW)` が保存された。
