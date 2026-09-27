# テスト結果: C 仕様の新旧の判定を 26-35 桁の命令で行う

- `npm test`: 1427 passing（追加 3 件）。`rpgSpec.ts` を戻すと分類と lint の 2 件が落ちる（確認済み）。
- `npm run verify:defs`: pass。`verify-rpg-definitions.mjs`: 原典との差分なし（C-NEW の標識 9-11）。全定義の往復 OK。

## 受け入れ基準ごとの判定
- AC1: pass — `EVAL(H)`・`OF`/`N03` つきの `EVAL`/`IF` は C-NEW、`KEY … CHAIN` と `     C` は C-SPEC。
- AC2: pass — `EVAL(H)   TOTAL = AMOUNT + TAX + FREIGHT + X` に lint の指摘なし。
- AC3: pass — C-NEW の `INDICATORS`（9-11、右寄せ）で `OF` が 10-11 桁に入る。書き戻しで組んだ `     C   50              EVAL(H)   X = 10 / 3`
  と `     C  N50              EVAL      X = 0` を含む `verify/CNEWR.rpgle` が実機（SR-OSAKA）で `CRTBNDRPG` 可（リスト #1425。消していない）。
- AC4: pass — 上記。
