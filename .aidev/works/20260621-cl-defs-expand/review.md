# レビュー記録

## ラウンド 1（2026-06-21）

対象: P1 制御構造21件の定義JSON（`vscode-extension/resources/prompter/cl/*.json`）、構造検証スクリプト
（`vscode-extension/scripts/validate-prompter-defs.mjs`）、backlog 追記（`.aidev/backlog/cl.md`）。

### 観点別点検

- **要件適合**: requirement 完了条件①（優先度の高い P1 から作成・F4 ロード可能）②（原典一致）③（backlog 反映・
  追跡）をすべて満たす。85件は P1–P10 で分類追記済み、P1 21件は `[x]`。
- **正確性（原典準拠／主エージェント直読）**: 21件すべてパラメータ集合・必須・反復・要素リスト・定義済み値・
  既定値が原典 `docs/origin/cl/<CMD>.html` と一致（test 工程の機械 diff で 21/21 pass）。
- **規約適合（languageId 波及・AGENTS.md）**: `package.json` の `contributes`/`languages`/`activationEvents`・
  `fileScope.ts`・言語登録への変更なし（データ追加＋独立スクリプトのみ）。`.cmd` への CL 診断同居等の波及なし。
- **マッピング規約（cl-command-def skill）**: 固定選択肢のみ（CALLPRC 受け渡し *BYREF/*BYVAL）は dropdown、
  固定値＋自由入力の混在（ITERATE/LEAVE の *CURRENT、ENDSUBR の 0、CALLSUBR/CALLPRC RTNVAL の *NONE）は
  text＋help＋defaultValue で表現。skill 規約に整合。
- **保守性**: 既存 `cl/*.json` のトーン・構造・命名に一貫。論理式/コマンド文字列は text、修飾/要素リストは group。

### 指摘

- [nit] `cl/CALLPRC.json` PARM(group) の第2要素 `name` が日本語 `"受け渡し"` で、既存の group 子要素が
  英大文字識別子（RELATION/LIB/USER 等）である慣例から外れていた / 対応: 修正済（`name` を `"PASSING"` に変更、
  `description` は `"受け渡し"` を維持）。構造検証 再 green を確認。

### 判定

- must=0 / should=0 / nit=1（修正済）。差し戻しなし。

### walkthrough 推奨判定（protocol §4.5）

- 差分は単一カテゴリ（CL プロンプター定義）への定義データ追加＋独立スクリプトで、処理フローの複雑さ・
  複数モジュール横断はない。→ walkthrough（任意）は不要と判断し deliver へ進む。
