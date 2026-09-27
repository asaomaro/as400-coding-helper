# テスト結果: プロンプト・タイプとデータ域（P15）

- `npm test`: 1496 passing（追加 2 件）。prompter e2e 76/76、全定義の往復 OK。

## 受け入れ基準ごとの判定（本物の VS Code。`docs/research/20260927-f4-prompter-exploration/driver.mjs`）
- AC1: pass — 空行で F4 → 「** プロンプター」、目盛り `....+... 1 ...+... 2 …`、タイプ `**`。`     C … SETON … LR` を入れて OK → その行が書かれた。
- AC2: pass — 空行でタイプを `CX` にして OK → 「C-NEW プロンプター」で開き直す。空の `     C` の行（C-SPEC、命令が必須で空）でもタイプを `CX` にすると C-NEW で開き直した。
- AC3: pass — 空行から C-NEW で `EVAL X = 1` → `     C                   EVAL      X = 1`（6 桁目に C）。
- AC4: pass — 単体テスト（`C-NEW`↔`CX`、RPG III の `E`、`CX` は RPG III では使えない、未知のタイプは undefined）。
