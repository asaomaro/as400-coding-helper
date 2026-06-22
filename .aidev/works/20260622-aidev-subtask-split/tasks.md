# タスク: サブタスク分割（subtask 層）の導入

## CLI（bin/aidev = sh・正本）
- [x] T1: `resolve_work` がスラッシュ入り slug（`<slug>/<NN>-<subslug>`）を `works/<path>` に解決
- [x] T2: `aidev new <NN>-<subslug> --parent <slug>` で子フォルダ＋子 state.yml（`parent` 付き）生成、親 state.yml の `subtasks`/`activeSubtask` 更新（依存: T1）
- [x] T3: `guard`/dependsOn 充足判定がネストパスの subtask slug を解決（兄弟は親配下に解決・完了=review承認 / guard は親の上流成果物を継承・doctor が subtask も横断）（依存: T2）
- [x] T4: `CURRENT_SCHEMA` を 2→3。schema 2/未記載 work は subtask 不変条件を legacy 免除（後方互換）（依存: T2）

## CLI パリティ（ps1・テスト）
- [x] T5: `aidev.ps1` を sh と挙動一致（T1–T4 相当。単一要素配列は `@()` 強制で回避）（依存: T4）
- [x] T6: `test/run.sh` に subtask 系ケース（sh 全環境）＋パリティ節（pwsh 必須・本環境は skip=1）を追加（依存: T5）

## protocol / skills
- [x] T7: `aidev-00-start/protocol.md` の state スキーマ（subtasks/activeSubtask/parent・schema 3）と §2.8 subtask 層を追記（依存: T4）
- [x] T8: `aidev-30-plan/SKILL.md`：3層決定木の split 判定・subtask 生成手順・subtask plan の scope 凍結（依存: T7）
- [x] T9: `aidev-60-review/SKILL.md`：親「統合 review」と差し戻し先＝該当 subtask coding（案1）（依存: T7）
- [x] T10: `aidev-50-test/SKILL.md`：親「統合 test」追加・subtask test は単独検証可能範囲に限定（依存: T7）

## docs
- [x] T11: `aidev-docs/DESIGN.md` §5 を3層決定木に改訂、refactor 等の非対象を釘刺し（依存: T8,T9,T10）
