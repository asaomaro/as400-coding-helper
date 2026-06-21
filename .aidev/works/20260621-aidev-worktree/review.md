# レビュー記録

## ラウンド 1（2026-06-21）

差分対象: `bin/aidev` / `bin/aidev.ps1` / `bin/test/run.sh` / `bin/README.md` / `protocol.md`。
観点: 要件適合・正確性・規約適合（AGENTS.md）・保守性。重点: INV-1・git実exit code判定・set -e安全性・sh⇔ps1一致・非回帰。

- [must] `bin/aidev.ps1` `Wt-Add` / 既存work分岐 — `$mw = WorksMatchingSlug ...` が**単一要素配列をスカラー文字列にアンラップ**する。
  PowerShell は要素1個の配列を `return` でアンロールするため、1件一致時 `$mw` は文字列になり、`$mw[0]` が
  **文字列の先頭1文字**（`'existing'[0]` → `'e'`）を返す。結果、worktree の `.aidev/current` と表示が壊れる。
  sh 版は該当しない（テキスト処理）。/ 対応: **差し戻し（coding で `$mw = @(WorksMatchingSlug ...)` と配列強制）**。
  ※ pwsh 不在で実機未検出。コード照合で確定（decisions D3 の「構造パリティで担保」の実効性を示す指摘）。

- [nit] `wt_rm <slug>` の解決 — slug が main worktree のブランチ `feature/<slug>` に一致すると main worktree を対象に拾う。
  git が「主ワーキングツリーは remove 不可」で弾くため実害は無いが、エラーメッセージが汎用的。
  /対応: 許容（git が構造的に防御。将来、main worktree 明示除外で文言改善の余地）。

- [nit] git 不在 exit1 は自動スイートに無く実機手動検証（test 工程B）。/対応: 許容（PATH 制約の再現が重く、手動で確認済み）。

判定: **must 1件 → coding へ差し戻し**。should 0 / nit 2。

## ラウンド 2（2026-06-21・差し戻し後の再レビュー）

- [must] ps1 単一要素配列アンラップ — **解消**。`$mw = @(WorksMatchingSlug ...)` で配列強制（decisions D4）。
  0件→Count0(new分岐) / 1件→Count1・`$mw[0]`正 / 2件→Count2(曖昧die) を満たすことをコードで確認。
- 非回帰: sh 自動スイート 35件 pass を再確認。sh 版は本指摘に非該当。
- 残: nit 2件（main worktree ブランチ一致時の汎用文言 / git不在の手動検証）はいずれも許容。

判定: **must/should なし（クリーン）**。残は nit のみ → deliver へ。must=1(検出・解消) / should=0 / nit=2。
