# 要件: 高結合 work のサブタスク分割を aidev ワークフローに導入する

## 背景 / 課題

現行 aidev は `works/<slug>` = 1 work = 1 PR をフラットな不変条件としている。
DESIGN.md §5 の split 判定は「低結合→別 work/PR、高結合→割らない」の2択で、
**「高結合だが大規模で、1 PR のままレビュー負荷を分割したい」work** の受け皿がない。
現状その層は §5 option 3（単一サイクル＋walkthrough のコミット構成）しかなく、
大きな高結合 work で漸進的な実装・レビューができない。

## ゴール

1 PR を維持したまま、高結合 work の内部を**サブタスク単位で漸進的に実装・レビュー**でき、
全サブタスク完了後に**統合 test＋統合 review** を経て deliver できるワークフローを定義する。

## スコープ（対象）

- **split 判定ルールの改訂**：軸の列挙ではなく、検証可能性 seam を discriminator とした
  **3層決定木**（別 work / subtask / 不可分）として `aidev-docs/DESIGN.md` §5 に明文化。
- **subtask 層の新設**：`works/<slug>/<連番>-<subslug>/` のフォルダ構成。各 subtask が
  plan→coding→test→review の子サイクルを回す。
- **state モデル**：各 subtask が独立したフラット `state.yml` を持つ（案B）。親 `state.yml` に
  `subtasks` / `activeSubtask` を追加。`.aidev/current` が active なパスを指しカーソルを兼ねる。
- **親工程の追加**：subtask 完了後に**親統合 test ＋親統合 review**を置く。
- **差し戻し**：親統合 review の sent_back は**該当 subtask の coding へ差し戻す**（案1）。
- **skill 改訂**：`aidev-30-plan`（split 判定・subtask 生成・subtask plan の scope 凍結）、
  `aidev-60-review`（統合 review）、`aidev-00-start/protocol.md`（state スキーマ・工程一覧）、
  `bin/aidev`（sh）/`bin/aidev.ps1`（ps1）/`test/run.sh`（パリティ）。

## スコープ外（non-goals）

- 低結合 work の別 PR 分割（既存 `dependsOn` / §5 で対応済み。変更しない）。
- 振る舞い不変な変更（refactor 等）を subtask 軸にすること（別 work か commit 構成へ振る——明示的に弾く）。
- AS400 拡張機能本体のドメイン機能（本 work はワークフロー基盤の改修）。

## 合意済みの判断（この会話で確定）

1. **split 判定原則は単一**：「単独で検証・デリバリ可能か」を各階層の discriminator にする。軸は列挙しない。
2. **subtask 工程＝plan→coding→test→review**（本ゲート。軽量チェックポイント案は不採用）。
3. **state モデルは案B**（各 subslug が独立フラット state.yml）＋親カーソル。案A（親に全ネスト）は
   最小 YAML ヘルパー・sh/ps1 パリティと矛盾するため不採用。
4. **subtask test は単独検証可能な範囲に限定**し、結合検証は**親統合 test**で行う（§5「検証可能性が seam」に整合）。
5. **subtask plan は scope 再決定禁止**（親 plan が割れ目を凍結済み）。tasks.md 分解と dependsOn 順序付けに限定。
6. **親統合 review の差し戻しは該当 subtask の coding へ**（案1）。

## 完了条件

- 3層決定木が DESIGN.md §5 に反映され、refactor 等が subtask に落ちない釘刺しがある。
- subtask の state/フォルダ/工程遷移が protocol.md と各 skill に矛盾なく定義されている。
- `bin/aidev`（sh/ps1）の改修点が specced され、schema バージョン方針と後方互換が決まっている。
