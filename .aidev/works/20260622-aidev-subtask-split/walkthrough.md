# Walkthrough: サブタスク分割（subtask 層）の導入

人間レビューを助けるための変更の歩き方。**実装(CLI)→規約(protocol)→利用側(skills)→docs** の順で読むと依存が辿りやすい。

## この PR が入れるもの（一言）

split 判定を**3層決定木**（別 work / subtask / 不可分）に整理し、中段の **subtask 層**を新設。
高結合で大規模な work を **1 PR 維持のまま** `works/<親>/<NN>-<subslug>/` に割り、各 subtask が
plan→coding→test→review を回し、全完了後に親が統合 test→統合 review→deliver する。

## レビュー推奨順と着眼点

### 1. `.aidev/bin/aidev`（sh・正本）— 機能の核
- `CURRENT_SCHEMA` 2→3。schema≤2 は legacy 免除（後方互換の要）。
- `resolve_work`：ネストパス `<親>/<NN>-<subslug>` をそのまま `works/<path>` に解決（追加ロジックなし＝低リスク）。
- `set_or_append`：state.yml の key を冪等更新（subtasks/activeSubtask 用）。
- `cmd_new` の `--parent` 分岐：**ここが新規の主要ロジック**。子 state.yml（`parent`/`current: plan`）生成＋
  親の `subtasks` 追記・`activeSubtask` 初期化。**着眼**: 親 subtasks は keep-all+append-if-absent（ps1 と一致。
  review R1 で修正した箇所）。
- `eval_depends`：兄弟 subtask を bare 名で親配下に解決、**完了=review 承認**（top-level は deliver 承認）。
- `need_file`：subtask は **requirement/spec/design のみ**親から継承（plan/tasks は subtask 固有。review R1 で限定）。
- `cmd_doctor`：subtask（ネスト1段）も verify 横断。

### 2. `.aidev/bin/aidev.ps1`（Windows）— sh と1:1の挙動一致
- 同じ変更を移植。**着眼（AGENTS.md パリティ罠）**: `@($cur + $slug)` で単一要素配列アンラップを回避、
  `needFile` の継承限定、`Eval-Depends` の親解決。**pwsh 不在のため本環境では未実行**＝CI で要検証。

### 3. `.aidev/bin/test/run.sh` — 検証
- `== subtask 層 ==` 節（sh 全環境で実行）：new --parent / 親 subtasks 更新 / guard 継承（spec 継承 vs plan 非継承）/
  兄弟 dependsOn（未review=3→review済=0）/ doctor 横断 / verify パス解決。
- パリティ節に subtask 系（doctor/status/metrics の sh⇔ps1 突合＋ps1 new --parent 実機）を追加。**pwsh で要実行**。

### 4. `protocol.md` — 規約の正典
- §6 schema 3 と subtasks/activeSubtask/parent。§2.8 を新設（subtask 層の規約一式：フォルダ・工程レイヤリング・
  カーソル・兄弟依存・差し戻し）。

### 5. skills（利用側）
- `plan`：split 判定の3層決定木・subtask 生成手順・**子 plan の scope 凍結**。
- `review`：親=統合 review、差し戻し先=該当 subtask coding。
- `test`：親=統合 test、subtask test は単独検証可能範囲に限定。

### 6. `aidev-docs/DESIGN.md` §5 — 設計判断の記録
- 3層決定木に改訂。**refactor 釘刺し**（振る舞い不変変更は subtask に落とさない）。

## あえて割り切った点（レビューで合意したい）
- **本 work 自身は subtask 分割しない**（自己言及ブートストラップ＝subtask 機能が動く前に自分を割れない）。単一サイクルで実装。
- **doctor/status は subtask を件数ロールアップしない**（doctor は verify 横断するが status 集計は親単位）。follow-up 候補。
- **pwsh パリティが未検証**（skip=1）。CI 必須。

## 動作確認
- `sh .aidev/bin/test/run.sh` → pass=58 fail=0 skip=1。
- `aidev doctor`（実 repo）→ works=17 fail=0 legacy(免除)=5（既存壊れず）。
