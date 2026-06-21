# 決定記録

## D1: work 作成は worktree をカレントにして既存 `new` に委譲する（複製しない）

- 背景: `worktree add` で新規 work を作る際、state.yml/metrics.yml 初期化・採番・current 設定を再実装すると二重管理になる。
- 決定: `( cd "<worktree>" && "<worktree>/.aidev/bin/aidev" new <slug> ... )` と、worktree 内の同一バイナリに委譲する。
- 理由 / 代替案: README の「単一検証経路」方針に合致（DRY）。`new` の find_root が worktree の `.aidev` を解決し、
  current も worktree 側に書かれるため INV-1 を自然に満たす。専用ロジック複製は退けた。
- 影響: spec の wt_add 手順どおり。worktree のバイナリは追跡済みで実行ビットも保持されることを実機確認。

## D2: `set -e` 下で `matches=$(works_matching_slug ...)` が落ちる問題を関数末尾 `return 0` で回避

- 背景: `works_matching_slug` のループ最終比較 `[ ... = slug ]` が偽(1)を返すと関数が非0終了し、
  `set -eu` 環境では `matches=$(...)` 代入ごとスクリプトが停止していた（add が無言 exit 1）。
- 決定: 関数末尾に明示 `return 0` を置く。
- 理由: 列挙関数の戻り値は「最後の比較結果」ではなく「列挙の成否」であるべき。実機 sh -x で原因特定して修正・再検証済み。
- 影響: wt_add の new 委譲経路が正常化。INV-1・list・rm も実機で通過。

## D3: ps1 は pwsh 不在環境のためランタイム未検証（構造パリティで担保）

- 背景: 本開発環境に pwsh が無く、`aidev.ps1` の worktree 実装を実行検証できない。
- 決定: sh 実装と既存 ps1 イディオム（`$LASTEXITCODE` 判定・`WriteText`・`Fmt-Table`・`YGet`/`YList`）に厳密一致させ、
  `bin/test/run.sh` のパリティ節（pwsh があれば sh と出力・終了コードを突合）に検証を委ねる。
- 補足: git をネイティブ呼び出しするため、PS7.4+ の `$PSNativeCommandUseErrorActionPreference` を `$false` にして
  `git show-ref` 等の正常系 exit!=0 が例外化しないようにした。
- 影響: pwsh のある CI / Windows 実機で T6 パリティ節が worktree も突合する想定。

## D4: review round1 で ps1 の単一要素配列アンラップ（must）を coding 差し戻しで修正

- 背景: `Wt-Add` の `$mw = WorksMatchingSlug ...` は 1件一致時、PowerShell の return アンロールで
  スカラー文字列化し、`$mw[0]` が先頭1文字になる（worktree current が壊れる）バグ。コード照合で検出（pwsh 不在で実機未検出）。
- 決定: `$mw = @(WorksMatchingSlug ...)` と配列強制。`@()` は 0件→Count0 / 1件→Count1・[0]正 / 2件→Count2 を満たす。
- 理由: PowerShell の標準的な「配列を保証する」イディオム。0件時に `@($null)` で誤 Count1 にならないことも確認（出力無し→空配列）。
- 影響: D3 の「構造パリティで担保」が実際に must を1件捕捉した実例。sh 版は該当せず。
