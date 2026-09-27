# テスト結果: C 仕様書の命令コードに候補を出す

- `npm test`: 1480 passing（追加 2 件）。

## 受け入れ基準ごとの判定
- AC1: pass — C-NEW: CALLP DATA-INTO DOU DOW ELSE ELSEIF EVAL … と ENDIF / ENDSL。C-SPEC: ACQ ADD … CHAIN … MOVEL … Z-SUB。互いに重ならない。総称（`ANDxx` 等）は入らない。
- AC2: pass — C-NEW の `EVAL(H)` にエラーなし（`restricted: false`）。
- AC3: pass — 本物の VS Code（`docs/research/20260927-f4-prompter-exploration/driver.mjs`）で `EVAL` の行は「C-NEW プロンプター」に EVAL・ENDIF の候補（CHAIN は無し）、
  `CHAIN` の行は「C-SPEC プロンプター」に CHAIN の候補（EVAL は無し）。
