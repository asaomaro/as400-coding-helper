# 要件: 桁幅を超える値を黙って切り捨てない

## 背景 / 課題
2026-09-27 の実操作調査（`docs/research/20260927-f4-prompter-exploration/findings.md` の P3）で、F4 プロンプターの桁の決まった欄に
桁幅より長い値を入れると、書き戻しで**左から黙って切られる**ことが分かった。C 仕様の演算項目 2 に `DSPDATE = %DEC(%DATE():*YMD)` を入れると
`(%DATE():*YMD)` だけが書かれ、D 仕様の `EXTPROC('…')`（40 文字）は `PROC('…'` に化けた。エラーは出ない。

原因は `buildRpgLineText` の `slice(-sourceLength)` と、定義の `maxLength` が桁幅より大きい欄（C の演算項目 30＞14、D の KEYWORDS 40＞37、FROM 30＞7）。
検査は `maxLength` しか見ていなかった。

## 目的 / ゴール
桁幅を超える値は欄のエラーになり、確定できない（黙って書き換わらない）。

紐づく charter ゴール: 固定長フォーマットの入力補助（プロンプター）

## 完了条件 (受け入れ基準)
- [ ] AC1: 桁の決まった欄（`sourceStart`/`sourceLength` を持つ）に桁幅を超える値を入れると、その欄にエラーが出て `hasErrors` になる（単体テスト）。
- [ ] AC2: 画面でも入力した時点でエラーが出て、確定できない。桁幅に収めるとエラーが消える（GUI e2e `dev/prompter-e2e.mjs`）。
- [ ] AC3: 桁幅ちょうどの値は通る。全定義の往復（`verify-prompter-roundtrip.mjs`）と既存テストが通る。
