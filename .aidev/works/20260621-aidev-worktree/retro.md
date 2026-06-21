# 振り返り: `aidev worktree`（ユーザー責任の並行作業 on-ramp）

## サマリ

会話の設計問答（汎用自動並列化は割に合わない→ユーザー責任の on-ramp に絞る）から始め、aidev ワークフローを
requirement→research→spec→plan→coding→test→review→deliver まで全工程ゲート通過で着地（PR #27）。
リードタイム約26分（lead=1568s）、差し戻し1回（review→coding の ps1 must）、自動テスト35件 pass。

## うまくいった点

- **research を1工程挟んで設計の根幹を実機で実証**した。「gitignored な `.aidev/current` は worktree ローカルで
  main と非干渉（INV-1の土台）」「base省略=HEAD」「同一ブランチ二重checkoutはgitが拒否」「未コミットworkは非伝播」を
  事実で固めたため、spec が誤前提で書かれず、**coding の reworks=0**（仕様起因の手戻りゼロ）に寄与した。
- **既存 `new` への委譲（add内new）**で状態機構を増やさず DRY に実装。README の「単一検証経路」方針に整合。
- **review がコード照合で ps1 の must を1件捕捉**（pwsh 不在でランタイム検証できない surface でも、構造パリティ点検が
  機能した実例）。test 緑→review スルー、にならなかった。

## 課題 / 手戻り

- **`set -e` × `$(列挙関数)` の停止**: `works_matching_slug` がループ最終比較の偽値(1)を返し、`matches=$(...)` 代入ごと
  スクリプトが無言 exit 1。coding 中に `sh -x` で実機追跡して特定・修正（decisions D2）。spec/plan 段で
  「`set -eu` 下の shell 罠」を観点に持っていれば前段で予防できた可能性。
- **記録フィデリティの乖離**: review で `event review sent_back` は記録したが、ps1 を直して再検証する際に
  **`event coding start` を再記録しなかった**。結果 `metrics.yml` は sent_backs=1 だが **reworks=0**（coding start が1回）で、
  「1回手戻りした」実態と指標がズレた。差し戻し→再入の記録規約が曖昧。
- **ps1 のランタイム未検証**: 本環境に pwsh が無く、`aidev.ps1` の worktree 実装は実行検証できないまま着地。
  しかもその surface が must を1件出した（=壊れやすい）。構造パリティに頼るしかなかった（decisions D3/D4）。

## 改善提案

### 製品 / コード（→ issue 候補）

- **run.sh のパリティ節を worktree にも広げる**: 現状の sh⇔ps1 突合は `status`/`metrics` 引数のみで、
  **worktree add/list/rm は ps1 突合の対象外**。pwsh 環境（CI）で worktree も突合するケースを追加し、
  今回ランタイム未検証だった ps1 の穴を恒久的に塞ぐ。
- **`rm <slug>` の main worktree 一致時の文言改善**（nit）: slug が main の `feature/<slug>` に一致すると
  main worktree を拾い、git 汎用エラーで弾かれる。main worktree を明示除外し分かりやすいメッセージにする。

### PJ プロセス / 規約（→ AGENTS.md）

- **POSIX sh `set -eu` の罠を規約化**: 列挙/探索関数は末尾 `return 0`、`var=$(func)` は func の非0終了で
  スクリプトごと落ちる、を「shell 実装の観点」に追補（今回の D2 を一般化）。
- **sh/ps1 二本立て CLI の PowerShell 既知罠**: 「要素1個の配列は return でスカラーにアンロールされる →
  `@()` で配列強制」を明記（今回の D4 を一般化）。review 観点チェックリストにも載せる。

### ハーネス自体（→ aidev-* への提案・適用は人間）

- **差し戻し時の再入記録を明文化**: review/test→coding の差し戻しで修正する際、`event coding start` の
  再記録を促す手順を `aidev-60-review`/`aidev-50-test`（または protocol「3.差し戻し分岐」）に追記する。
  さもないと **reworks 指標が手戻りを取りこぼす**（今回 sent_backs=1 と reworks=0 の乖離が実例）。
  代替案: `aidev event <phase> sent_back` が次工程の start を自動誘導／警告する。
- **検証の環境依存をゲートで可視化（任意）**: パリティ等の検証が環境不足（pwsh 不在）で skip された場合、
  deliver/verify がその「未検証 surface」を警告として残す。現状は人手で PR に注記しており、抜けると気づけない。
