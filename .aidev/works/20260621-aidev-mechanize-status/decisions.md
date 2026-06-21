# 決定記録

## D1: ps1 はこの環境で実行不可（pwsh 不在）。パリティは sh 実行＋コード対応で担保

- 背景: 開発環境に `pwsh` が無く、`aidev.ps1` を実行検証できない。
- 決定: sh 側は実行テストで検証し、ps1 側は sh と1対1で対応する実装をコードレビューで担保する。
  パリティテスト（sh⇔ps1 diff）は pwsh 不在時 skip とし、その旨をテスト出力に明示する。
- 理由 / 代替案: pwsh 導入は環境依存で本作業のスコープ外。既存 CLI も同方針（sh を主に検証）。
- 影響: ps1 のリグレッションは CI（pwsh あり）または利用環境で最終確認が必要。test/review で明示する。

## D2: eval_depends は EVAL_UNMET / EVAL_ADVISORY の2系統に分離

- 背景: guard は「works 由来の未充足→exit 3」「外部チケット #N→advisory(warn のみ)」と扱いが異なる。
  status はその両方を deps 列に表示したい。
- 決定: 共有 `eval_depends`(sh) / `Eval-Depends`(ps1) は未充足を EVAL_UNMET（exit 影響）と
  EVAL_ADVISORY（#N 生トークン）に分けて格納。guard は従来の exit/warn 挙動を維持、status は両者を
  併記（advisory は `#N(advisory)` と装飾）。
- 理由 / 代替案: 単一リストにすると guard の exit 判定で advisory を誤って未充足扱いしてしまう。
- 影響: guard の出力・exit コードは不変（回帰テストで担保）。

## D3: yget/YGet の inline コメント除去を廃止し、囲みクォート除去に変更（既存バグ修正）

- 背景: `yget` が `sed 's/#.*//'` で inline コメントを除去していたため、`ticket: #24` や
  `dependsOn: [a, #99]` の `#` 始まり値が「コメント」として消えていた。これは status だけでなく
  **既存 guard の `#N` 外部チケット依存が黙って無視される潜在バグ**でもあった（status テストで検出）。
- 決定: state.yml/metrics.yml は機械生成でコメントを含まないため、yget/YGet は inline コメント除去を
  やめ、代わりに前後空白と囲み二重引用符を除去する（`"#42"`→`#42`）。sh/ps1 とも一致。
- 理由 / 代替案: `#` をコメントと値で曖昧判定する案は脆い。実ファイルにコメントが無い前提なら除去廃止が最も安全。
- 影響: guard の `#N` 依存が正しく advisory 表示されるようになる（挙動改善）。回帰テストで既存出力の不変を確認済み。

## D4: status の next 列は deliver 承認済(done=yes)なら一律 '-'

- 背景: 非標準パイプライン記録（batch 記録等で approved が標準工程を網羅しない）だと、deliver 済でも
  「next=requirement」のような誤解を招く表示になった。
- 決定: done（approved に deliver）が真なら next は計算せず `-`。done が偽のときのみ標準パイプラインで
  未承認の最初の工程を next とする。
- 理由: done を権威とし、完了済み作業に「次工程」を示さないのが意味的に正しい。
- 影響: spec の next 定義に「done なら -」を明文化（spec.md と整合）。

## D5: aidev CLI のシェルテストを .aidev/bin/test/run.sh に新設

- 背景: CLI(sh/ps1) 用のテスト基盤が無かった（vscode-extension のテストは拡張機能用で無関係）。
- 決定: Node 非依存のシェルテスト `.aidev/bin/test/run.sh` を新設。一時フィクスチャで status/metrics の
  table/tsv・境界（legacy/未deliver/依存/手戻り/不正なし）・読み取り専用・既存コマンド回帰・sh⇔ps1
  パリティ（pwsh 無ければ skip）を検証。
- 影響: 今後の CLI 変更はこのテストで回帰検出できる。
