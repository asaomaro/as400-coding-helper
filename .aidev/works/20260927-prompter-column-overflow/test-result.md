# テスト結果: 桁幅を超える値を黙って切り捨てない

- `npm test`: 1417 passing（追加 2 件）。`model.ts` を戻すと追加の 2 件が落ちる（確認済み）。
- `node scripts/verify-prompter-roundtrip.mjs`: 538 定義で往復 OK。
- `dev/prompter-e2e.mjs`: 74/74 PASS（追加 3 件）。

## 受け入れ基準ごとの判定
- AC1: pass — C の演算項目 2 に 28 文字 → 「14 桁に収まりません（28 文字）。」、`hasErrors`。
- AC2: pass — 画面で入力した時点で FACTOR2 にエラー、確定ボタンで確定されない、`%DATE()` に直すと消える。
- AC3: pass — D のキーワード 37 文字は通り、38 文字でエラー。往復検証・既存テスト全件が通る。
