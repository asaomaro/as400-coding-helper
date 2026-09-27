# テスト結果: 欄を桁の決まりどおりに寄せる

- `npm test`: 1424 passing（追加 7 件）。書き戻しでレイアウトを使わないよう戻すと 5 件落ちる（確認済み）。
- `npm run verify:defs`: pass。`node docs/origin/verify-rpg-definitions.mjs`: 原典との差分なし（結果標識の 3 欄は並べて 71-76）。
- `node scripts/verify-prompter-roundtrip.mjs`: 538 定義で往復 OK。
- 生成物: `generate-dds-prompter.mjs`（ja/en）・`generate-rpg-spec-definitions.mjs` を流し直した差分だけ。

## 受け入れ基準ごとの判定
- AC1: pass — C 条件標識 `OF`→10-11 / `N01`→9-11、結果標識 等しい `50`→75-76、D 開始位置右寄せ、DSPF 条件付け `40`→9-10・`N40 41`・`*DS4`→9 桁目、
  小数 `0`→37、位置 `7 74`→`  7 74`、PRTF の位置 `10`→42-44。
- AC2: pass — 位置 `1 2 3`・条件付け `AB` はエラー、`N40N41` は通る。
- AC3: pass — 実機（SR-OSAKA、IBM i 7.3、ASAOLIB）。
  - プロンプターの書き戻しで組んだ `P4D.dspf` は `CRTDSPF` 可（リスト #1421）、`P4R.rpgle` は `CRTBNDRPG` 可（#1423）。
  - 対照: 小数を左詰めの `P4DECL` と位置を左詰めの `P4POSL` は CPD7422 で作成できない。右寄せの `P4DECR` は作成できる。
    D の開始位置を左詰めの `P4RL` は RNF0263（#1424）。
- AC4: pass — 上記。

スプールは消していない（QPRTJOB の P4DECR/P4DECL/P4POSL/P4D/P4R/P4RL のリスト）。
