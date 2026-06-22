# 仕様: サブタスク分割（subtask 層）

## 用語

- **work（親）**：`works/<YYYYMMDD-slug>/`。1 work = 1 PR。feature 全体の lifecycle を所有。
- **subtask（子）**：`works/<YYYYMMDD-slug>/<NN>-<subslug>/`。高結合 feature の漸進実装単位。
  `NN` は2桁連番（`01`,`02`…）、`subslug` は kebab-case。
- **3層決定木**：split 判定を「別 work / subtask / 不可分」に振り分ける単一の決定木（§5 改訂）。

## 1. split 判定（3層決定木）— DESIGN.md §5 を改訂

discriminator は単一原則：**そのピースは単独で検証・デリバリ可能か**。

```
そのピースは単独で検証・デリバリ可能か？
├─ YES（低結合）            → 別 work / 別 PR（§5 planner 層。dependsOn でスタック。refactor 先行はここ）
└─ NO（相互依存・共同検証のみ）
      大きく、漸進レビューで負荷を割れるか？
      ├─ YES                → subtask 分割（本仕様の新設層）
      └─ NO（不可分）        → 単一サイクル ＋ walkthrough のコミット構成（§5 既存 option 3）
```

- **新軸は導入しない**。frontend/backend・層別・機能別はすべてこの原則の適用結果にすぎない。
- **明示的な非対象**：振る舞い不変な変更（refactor 等）は単独検証可＝低結合。subtask に落とさず
  別 work（先行 PR）か、分離不能なら同一 work 内の順序付きコミット＋walkthrough へ振る。

## 2. 工程レイヤリング

```
親（feature / 1 PR）
  requirement → research → spec → design → plan★（=split 判定。subtask 生成）
        │  ★ interactive: ユーザーに分割可否を委譲 / autonomous: 自律判定
        ├─ 01-subslug:  plan → coding → test → review     （subtask 子サイクル）
        ├─ 02-subslug:  plan → coding → test → review     （dependsOn で producer→consumer 順）
        └─ …（全 subtask の review 承認で完了）
  → 統合 test → 統合 review → walkthrough → deliver → retro
```

- 親 plan＝feature を subslug へ割る「メタ plan」。割らない判断なら従来どおり直接 coding へ。
- subtask は親 spec/design を継承し **plan から開始**（subtask 独自の spec/design は持たない）。
- subtask plan は **scope 再決定禁止**：tasks.md 分解と dependsOn 順序付けに限定。
- subtask test は **単独検証可能な範囲（unit・契約モック）に限定**。
- 結合検証は **親統合 test**、結合起因の指摘は **親統合 review** が担う。

## 3. state モデル（案B＋親カーソル）

### 親 state.yml（追加フィールド）

```yaml
schema: 3                       # 2→3 に上げる（subtasks/activeSubtask 導入）
slug: aidev-subtask-split
current: plan                   # 親 lifecycle の工程
approved: [requirement, spec, design, plan, ...]
mode: interactive
subtasks: [01-backend, 02-frontend]   # 追加: 子の一覧（フローリスト。yget/ylist で読める）
activeSubtask: 01-backend             # 追加: 実行中の子。全完了で `done`（スカラ）
dependsOn: []
```

### 子 state.yml（既存スキーマを再帰適用・フラットのまま）

```yaml
schema: 3
slug: 01-backend               # 子 slug（連番-subslug）
parent: aidev-subtask-split    # 追加: 親 slug への逆参照
current: coding
approved: [plan, coding]
mode: interactive              # 親から継承
humanGates: []
maxSendBacks: 3
dependsOn: []                  # 同一親内の他 subtask（producer→consumer）も記述可
```

### カーソル（`.aidev/current`）

- 親工程中：`20260622-aidev-subtask-split`
- subtask 実行中：`20260622-aidev-subtask-split/01-backend`（パス。`resolve_work` がそのまま解決）

## 4. CLI（bin/aidev・aidev.ps1）への要求

- **resolve_work**：`slug` にスラッシュ入りパス（`<slug>/<NN>-<subslug>`）を許可し `works/<path>` を解決。
- **new**：subtask 生成モード（`aidev new <NN>-<subslug> --parent <slug>` 想定）。
  子フォルダ＋子 state.yml（`parent` 付き）を作り、親 state.yml の `subtasks`/`activeSubtask` を更新。
- **guard / dependsOn**：ネストパスの subtask slug を依存先に解決できること。
- **schema**：`CURRENT_SCHEMA` を 2→3。schema 未記載/2 の既存 work は legacy として subtask 機能の不変条件を免除（後方互換）。
- **sh/ps1 パリティ**：全変更を両実装に入れ、`test/run.sh` パリティ節で機械突合（pwsh は CI 必須）。

## 5. 受け入れ基準

- 親 plan で「分割する/しない」を判定でき、interactive はユーザー委譲・autonomous は自律判定になる。
- subtask が plan→coding→test→review を独立 state.yml で回せ、`.aidev/current` がカーソルとして機能する。
- 親統合 review の must/should が**該当 subtask の coding** へ差し戻り、metrics に手戻りが記録される。
- 既存（schema 2）の work が壊れない。
- refactor のような単独検証可能な変更が subtask 決定木で **subtask に落ちない**（別 work / commit 構成に振られる）。
