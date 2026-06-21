# 要件: `aidev worktree` — ユーザー責任での並行作業 on-ramp

## 背景 / 課題

aidev ハーネスは **単一ワーキングツリー・直列**を前提に設計されている（`.aidev/current` が
単一ポインタ、各工程が承認ゲートで直列化）。一方で、独立性の高い複数 work を**並行**で進めたい
場面がある（特に低コンフリクトな定義ファイル生成など）。

ただし「汎用の自動並列化」は、このPJでは割に合わない（過去の検討結論）:

- 律速は**人間の承認ゲート**であり、interactive を並列にしても速くならない。
- 単一の小さなコードベースで work 同士が `package.json`(contributes) / `src/fileScope.ts` /
  言語登録など**共有ファイル**を触り、**languageId 波及**（AGENTS.md 規約）とマージ衝突を招く。
- CL/RPG プロンプター定義の**原典照合は主エージェント実施が必須**（委譲不可）で、並列委譲と相性が悪い。

そこで「ハーネスが勝手に並列化する」のではなく、**ユーザーが明示的に判断したときだけ**、1つの work を
専用 worktree＋ブランチに隔離して並行着手できる、**最小の on-ramp** を CLI に用意したい。

## 目的 / ゴール

ユーザーが `aidev worktree add <slug>` を**明示実行**したときに、その work 専用の git worktree と
ブランチを作り、隔離された場所で並行作業を開始できる状態にする。判断と責任はユーザーに置き、
ハーネスは隔離の準備と規約上の注意喚起に徹する。

## スコープ

### 対象

- `aidev` CLI（`bin/aidev`＋`bin/aidev.ps1`）への `worktree` サブコマンド追加: `add` / `list` / `rm`。
- 既存の隔離機構（gitignored `.aidev/current` が worktree ローカルになる性質）への明示的な乗せ替え。
- `add` 完了時の**規約警告出力**（共有ファイル / languageId 波及 / 原典照合の主導義務）。
- `help` / `bin/README.md` / `protocol.md` への追記。

### 対象外（作らない）

- 並列の**要否をハーネスが自動判断**すること。
- 複数 work の fan-out / merge を自動化する coordinator。
- マージ**コンフリクトの自動解決**。
- autonomous バッチの**一括並列実行**。
- worktree のマージ自体（既存 deliver / PR フローに委ねる）。

## 機能要件

- `aidev worktree add <slug> [--branch --base --path --mode --ticket]`:
  worktree＋ブランチを作成し、その worktree 内で work を確定（既存なら current 設定、無ければ `new` 相当）。
- `aidev worktree list`: aidev 管理 worktree を path / branch / work / 工程で一覧（読み取り専用）。
- `aidev worktree rm <slug>|<path> [--force --delete-branch]`: worktree を安全に削除
  （未コミット差分は既定で拒否、ブランチ削除は明示時のみ）。
- `add` 完了時に共有ファイル・languageId 波及・原典照合主導の**注意を必ず出力**する。
- 既定値は決定済み（「非機能要件」と設計書 §10 を参照）。

## 非機能要件 / 制約

- **POSIX sh / Node 非依存**で実装し、`aidev.ps1`（Windows）と**挙動・出力・終了コードを一致**させる
  （`bin/README.md` の方針）。
- 既存**終了コード体系**（0 / 1 / 2 / 3 / 4）を踏襲し、worktree 専用コードは増やさない。
- **INV-1: main tree の `.aidev/current` を絶対に書き換えない**（並行操作が主作業文脈を壊さない）。
- 既定値: base=**現在 HEAD** / path=**リポジトリ外の兄弟** `../<repo>-wt/<slug>` /
  ブランチ=**`feature/<slug>`**（既存 PR/issue 命名規約）/ work 作成=**`add` 内で `new`** を推奨。
- `worktree list` の aidev 管理判定は**ブランチ名ではなく `.aidev/current` の有無**を主キーにする
  （ブランチを `feature/*` に揃えるため）。

## 完了条件 (受け入れ基準)

- [ ] `aidev worktree add <slug>` で、`feature/<slug>` ブランチと `../<repo>-wt/<slug>` worktree が作られ、
      その worktree の `.aidev/current` が `<slug>` を指す。
- [ ] 既存 work（state.yml あり）に対する `add` は `new` を実行せず current 設定のみ行う。
- [ ] `add` 実行後も **main tree の `.aidev/current` が変化しない**（INV-1）。
- [ ] `add` 完了時に共有ファイル / languageId 波及 / 原典照合主導の警告が出力される。
- [ ] `aidev worktree list` が aidev 管理 worktree を `.aidev/current` の有無で正しく抽出する。
- [ ] `aidev worktree rm` が、未コミット差分時に既定で拒否し、`--force` で削除、`--delete-branch` 指定時のみ
      ブランチを削除する。削除後も main の current は不変。
- [ ] git 不在・パス/ブランチ衝突・使用法エラーで **exit 1** を返す。
- [ ] `aidev.ps1` が同名サブコマンドを持ち、sh 版と出力・終了コードが一致する。
- [ ] `usage()`（先頭コメント）/ `bin/README.md` / `protocol.md` に worktree が追記されている。

## 未確定事項 / 確認したいこと

- 設計上の主要判断（base / path / branch / work 作成タイミング）は**ユーザー確認済み**
  （設計書 `.aidev/design/aidev-worktree.md` §10、2026-06-21）。
- 技術前提「**gitignored な `.aidev/current` は git worktree ごとにローカルで、worktree 間で共有されない**」は
  原典（`.gitignore` と `git ls-files`）で静的に確認済みだが、**実機での挙動は spec/coding 前に
  実証で固めたい**（research 推奨候補）。
