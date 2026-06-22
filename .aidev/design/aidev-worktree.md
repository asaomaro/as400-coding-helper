# 設計: `aidev worktree`（ユーザー責任での並行作業 on-ramp）

> 状態: 提案（design）。正典は `.claude/skills/aidev-00-start/protocol.md` と `.claude/skills/aidev-docs/bin/aidev`。
> 本書は CLI に `worktree` サブコマンドを追加する実装可能設計。

## 1. 確定している前提（原典照合済み）

| 事実 | 出典 | 設計への含意 |
|---|---|---|
| `.aidev/current` は **gitignore 対象** | `.gitignore:16` | 各 git worktree が**独立した未追跡 `current`** を持つ。**worktree 間で衝突しない**＝ current がそのまま per-worktree ポインタになる |
| `.aidev/works/*`（state.yml/spec.md 等）は **追跡対象** | `git ls-files .aidev`（59件） | work 成果物はブランチに乗る。**1 worktree = 1 branch = 1 work** が自然な単位 |
| `resolve_work` 解決順 = 明示slug → `AIDEV_WORK` → `.aidev/current` | `bin/aidev:44-53` | 既存の隔離手段（`AIDEV_WORK`）は保険として残す。worktree モードは current で足りる |
| 既定は単一ワーキングツリーの直列 | protocol.md | worktree は**人間オプトインの逸脱**。自動では切らない |
| CLI は POSIX sh / Node非依存、ps1 と挙動一致、終了コード 0/1/2/3/4 | `bin/README.md` | 同作法を踏襲。新終了コードは増やさない |

**核心:** 「single shared pointer を取り合う」問題は存在しない。`current` が gitignored だから worktree ごとに勝手に分かれる。よって**新しい状態機構は不要**で、`git worktree` ＋ 既存 `current`／`new` に薄く乗せるだけでよい。

## 2. 目的 / 非目的

**目的:** ユーザーが明示判断したときに、1つの work を専用 worktree＋ブランチに隔離して並行作業を始める on-ramp を CLI に追加する。

**非目的（前回の結論どおり作らない）:**

- 自動並列化・並列要否のハーネス判断
- coordinator / fan-out・merge 自動化
- コンフリクト自動解決
- autonomous バッチの一括並列

## 3. 設計原則

1. **判断主体はユーザー。** トリガは `aidev worktree add` の明示実行のみ。エージェント/ハーネスは自分から worktree を切らない。
2. **隔離は既存機構に乗せる。** ワーキングツリー分離＝`git worktree`、ポインタ分離＝gitignored `.aidev/current`。新状態を足さない。
3. **1 worktree = 1 branch = 1 work。**
4. **main tree の `.aidev/current` を絶対に書き換えない。** worktree 操作が main の作業文脈を壊さない不変条件。
5. **破壊操作は安全側。** `rm` は未コミット差分があれば既定で拒否、ブランチ削除は明示フラグ時のみ。

## 4. サブコマンド surface

### 4.1 `aidev worktree add <slug> [options]`

```
--branch <name>   既定 feature/<slug>（既存 PR/issue 命名規約に合わせる）
--base <ref>      分岐元。既定 現在の HEAD
--path <dir>      worktree 設置先。既定 ../<repo名>-wt/<slug>（リポジトリ外の兄弟）
--mode <m>        work 新規作成時に渡す（interactive|autonomous）。既定 interactive
--ticket <ID>     work 新規作成時に渡す
```

> 既定ブランチが `aidev/*` ではなく `feature/*` のため、`worktree list`（§4.2）の aidev 管理判定は
> **ブランチ名ではなく `.aidev/current` の有無**を主キーにする（INV-4 とも整合）。

動作:

1. `find_root` でルート解決。`command -v git` で git 存在チェック（無ければ exit 1）。
2. ブランチ/パス/base を既定値で確定。`<repo名>` は `basename $ROOT`。
3. `git worktree add -b <branch> <path> <base>`。`<branch>` が既存なら `-b` を外して既存ブランチを checkout。失敗（パス衝突・ブランチ衝突）は git のメッセージを見せて exit 1。
4. 新 worktree 内で work を確定（**main tree には触れない**）:
   - その worktree のブランチに既に `.aidev/works/<slug>/state.yml` がある（main で作成→マージ済み等）→ 新 worktree の `.aidev/current` に `<slug>` を書くだけ（ポインタ設定）。
   - 無い → 新 worktree の中で `aidev new <slug> --mode <m> [--ticket ID]` 相当を実行（state.yml/metrics.yml 初期化＋current 設定）。
5. 結果サマリ出力: 作成した path / branch / work / current 工程、次アクション（`cd <path>` して各工程スキル）、§6 の共有ファイル警告。

終了コード: 0 / 1（git不在・使用法・git worktree 失敗）。

### 4.2 `aidev worktree list`

- `git worktree list --porcelain` を読み、各 worktree について path / branch を取得。
- 各 worktree の `.aidev/current`（あれば）から work slug、`state.yml` の `current:` から工程を読む。
- aidev 管理（branch が `aidev/*` または `.aidev/current` が存在）だけ抽出して表示。
- **読み取り専用。** 体裁は既存 `status` の `fmt_table` を流用。`--format table|tsv` を踏襲。

### 4.3 `aidev worktree rm <slug>|<path> [--force] [--delete-branch]`

- slug または path から対象 worktree を解決（`git worktree list` と突合）。
- 未コミット差分があれば既定で拒否（`git status --porcelain` 非空 → exit 1）。`--force` で `git worktree remove --force`。
- worktree 削除で、そこのローカル `.aidev/current`（未追跡）も一緒に消える。**main の current は不変。**
- `--delete-branch` 指定時のみ `git branch -D <branch>`（既定はブランチを残す＝安全）。

終了コード: 0 / 1。

## 5. 状態・ファイル相互作用（不変条件）

- INV-1: `aidev worktree *` は **main tree の `.aidev/current` を書き換えない**。
- INV-2: work 成果物（`works/*`）は各ブランチ側で進行。main への統合は既存 deliver/PR フロー（マージ）のまま。worktree 機能はマージに関与しない。
- INV-3: `AIDEV_WORK` は引き続き上書き手段として機能（worktree 内で別 work を一時参照する保険）。通常は current で足りる。
- INV-4: 既存 `doctor`/`status` は **そのワーキングツリーに見えている works** だけを対象にする現挙動を維持。別ブランチの未マージ work は main の doctor では見えない（誤検知回避）。**跨ぎの可視化は `worktree list` が担う。**

## 6. ガードレール（PJ規約遵守）

`add` 完了時に**必ず**次を出力する:

> ⚠ この work が `package.json`(contributes) / `src/fileScope.ts` / 言語登録に触るなら、他 worktree と
> **languageId 波及**・マージ衝突が起きうる（AGENTS.md「languageId / アクティベーション変更時の下流波及」）。
> 並行して良いかの判断はユーザー責任。
>
> CL/RPG プロンプター定義など**原典照合が要る work は主エージェント実施が必須**（AGENTS.md 検証規約）。
> worktree 並行でも委譲して検証を落とさないこと。

このメッセージはオプトインの「責任」を明文化する装置であり、機能の一部。

## 7. Windows パリティ

- `aidev.ps1` に同名 `worktree` を実装。`git worktree` はクロスプラットフォーム。
- OS 吸収はパス区切りと既定 path 組み立てのみ。挙動・出力・終了コードを sh 版と一致させる（README 方針）。

## 8. help / ドキュメント

- `bin/aidev` 先頭コメントブロックに `worktree add|list|rm ...` を追記（`usage()` が自動表示）。`aidev.ps1` も同様。
- `bin/README.md` のコマンド表に1行追加。
- `protocol.md` に worktree 節を新設: 「人間オプトインの並行 on-ramp / current は gitignored=worktree ローカル / 1 worktree=1 branch=1 work / main の current 不変（INV-1）」。

## 9. テスト（`bin/test/run.sh` に追加）

- `add`: ブランチ・worktree・current が作られる / 既存 slug は `new` せず current 設定のみ / git 不在で exit 1 / パス・ブランチ衝突で exit 1。
- `list`: `aidev/*` を拾い非対象 worktree を除外。
- `rm`: 未コミットありで拒否 / `--force` で削除 / `--delete-branch` の有無 / **main の `.aidev/current` 不変（INV-1）**。
- ps1 との出力・終了コード一致（既存テストの突合方式に合わせる）。

## 10. 決定事項（ユーザー確認済み 2026-06-21）

1. **既定 base = 現在の HEAD。** 作業中の文脈を引き継ぐ。main 起点が欲しい場合は `--base main`。
2. **worktree path = リポジトリ外の兄弟** `../<repo名>-wt/<slug>`。`.gitignore` を汚さず二重走査事故も避ける。
3. **ブランチ命名 = 既存 `feature/` 規約に合わせる**（既定 `feature/<slug>`、`--branch` で上書き）。
   `aidev/*` 専用プレフィックスは採らない。→ §4.2 list の判定キーは `.aidev/current` の有無にする。
4. **work 作成は「`add` 内で `new`」を推奨**として protocol に明記。両対応は維持（既存 work があれば current 設定のみ）。
