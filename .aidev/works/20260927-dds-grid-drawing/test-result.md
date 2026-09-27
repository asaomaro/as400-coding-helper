# テスト結果: 罫線をマウスで引く・動かす

- `npm test`: 1551 passing（本件 15 件）。`npm run verify:defs` OK。GUI e2e（DDS）は本件 16 段を足して 272/272 PASS（手元で止まる無関係の段は ±1 を許す写しで流した）、プロンプター 77/77。

## 受け入れ基準ごとの判定
- AC1: pass — 1 行のドラッグで `GRDLIN((*POS (6 10 31)) (*TYPE LOWER))`、縦横 2 以上で `GRDBOX((*POS (15 2 4 19)) (*TYPE PLAIN) …)`（GUI）。1 桁は `RIGHT`（単体）。
- AC2: pass — 罫線の様式が 1 つ（GRID）ならそこへ入り「様式 GRID に罫線を引きました」。無いファイル（CUSTMNT）では名前を聞き、`R LINES … GRDRCD` を作って書く（GUI）。罫線の様式でない様式へは書けない（単体）。
- AC3: pass — 罫線を押すと選べ、ドラッグで `*POS (4 2 3 30)`、つまみで幅 19→21、矢印↓で 1 行下、Delete で消える（他の罫線と GRDATR は残る）（GUI）。`*CONTROL` と `*DS3`/`*DS4` のもう一方は残る（単体）。
- AC4: pass — ツールバーで RED を選んで引くと `(*COLOR RED)`、既定の「指定しない」では書かない。プロパティで形を HRZ にすると `(*TYPE HRZ 1)`（GUI）。色・線種の書き換え／外し（単体）。
- AC5: pass — エディタの編集（`addGrid` で様式ごと作る・色／線種つき・`setGridKeyword` で形と位置と線種を変える）で組んだ `verify/GRIDED.dspf` は実機（SR-OSAKA、IBM i 7.3）の `CRTDSPF` で作成でき、メッセージ 0 件（スプール #1481）。
  対照の原典に無い形（`*TYPE BOGUS`、`verify/GRIDBAD.dspf`）は CPD7502 / CPD7520 / CPD7735 で作成できない（#1482）ので、実機は罫線のキーワードを検査している。
