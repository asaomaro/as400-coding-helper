# レビュー記録

## ラウンド1
- [should] MSGTYPE: 定義済み値が固定8種(*INFO/*INQ/...)のみ。`inputType: "text"`＋help列挙ではなく、
  **`inputType: "dropdown"` ＋ `options[]`** にすべき。types.ts は dropdown/options を備えており、
  プロンプターの入力補助としてこちらが適切。/ 対応: 差し戻し（coding で修正）
- [should] TOPGMQ.RELATION(*PRV/*SAME) も固定2値 → dropdown 候補。/ 対応: 差し戻し（coding で修正）
- [should/プロセス] research が IBM原典は読んだが、PJ自身のスキーマ型 `src/prompter/types.ts` を
  未確認だった。「enum欄なし」(decisions D1)は誤り。research/spec のスコープに
  「PJスキーマ型の確認」を含めるべき（cl-command-def skill へ反映）。/ 対応: skill修正＋D1是正
- [nit] CCSID/TOUSR は固定値＋自由入力の混在のため text 継続でよい（dropdownは不可）。

## ラウンド2（差し戻し対応後）
- MSGTYPE → dropdown(8択)、TOPGMQ.RELATION → dropdown(2択) に修正済み。re-test PASS。
- decisions.md D1 を是正、cl-command-def skill に「types.ts 確認＋固定値は dropdown」を反映。
- 残: must/should なし（CCSID/TOUSR は混在のため text 継続＝nit許容）。
- 判定: 指摘解消。deliver へ。
