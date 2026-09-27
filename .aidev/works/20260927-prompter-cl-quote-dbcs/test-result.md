# テスト結果: CL の文字ストリングを引用符で囲む・折り返しを実機の桁で数える

- `npm test`: 1453 passing（追加 5 件）。囲みと折り返しを戻すと 3 件落ちる（確認済み）。
- `npm run verify:defs` pass。`verify-cl-roundtrip.mjs`（原典の使用例 223 定義）・`verify-prompter-roundtrip.mjs`（538 定義）OK。
  `verify-cdml-rules.mjs`・`verify-cdml-attributes.mjs` OK。生成物の差分は `characterString` の追加だけ（1115 欄 × ja/en）。

## 受け入れ基準ごとの判定
- AC1: pass — `CMPLXPR で印刷エラー` → `MSG('CMPLXPR で印刷エラー')`、`It's done` → `MSG('It''s done')`。`'Already quoted'`・`&TEXT`・`'Count: ' *CAT &N` はそのまま。
- AC2: pass — `DONE` は囲まない。`CALL PGM(MYPGM)`（名前）も囲まない。
- AC3: pass — 文字数 60・実機 76 桁の行を折り返し、各行 72 桁以内。
- AC4: pass — 実機（SR-OSAKA、IBM i 7.3）で `verify/CLQUOTE.clle`（書き戻しで組んだ 3 行）は `CRTBNDCL` 可（#1459）。囲まない対照 `CLNOQ.clle` は CPD0018 で作成できない。
