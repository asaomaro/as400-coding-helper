# 仕様: `aidev worktree`（ユーザー責任での並行作業 on-ramp）

## 概要

`aidev` CLI に `worktree` サブコマンド（`add` / `list` / `rm`）を追加し、ユーザーが**明示実行**したときだけ
1 つの work を専用 git worktree＋`feature/<slug>` ブランチに隔離して並行着手できるようにする。
research（research.md）で「`.aidev/current` は worktree ローカルで main と非干渉（INV-1）」「base 省略=HEAD」
「同一ブランチ二重 checkout は git が拒否」「未コミット work は worktree に非伝播」を実機確認済み。
新しい状態機構は足さず、既存の `new` / `resolve_work` / gitignored `current` に薄く乗せる。

## 設計方針

- **既存の単一検証経路を再利用（DRY）**: work 作成は専用ロジックを複製せず、worktree をカレントにして
  既存 `new` を実行する（state.yml/metrics.yml 初期化・current 設定・採番を一手に委ねる）。
- **隔離は git ＋ gitignored current に委ねる**: worktree ごとの `.aidev/current` 分離は git の未追跡ファイル
  挙動でそのまま成立（research F1）。CLI は「current を worktree 側に設定する」だけでよい。
- **git の実 exit code を直接判定**（research リスク2）。パイプ越しに成功扱いしない。
- **POSIX sh / Node 非依存**、`aidev.ps1` と挙動・出力・終了コード一致（README 方針）。
- 既存**終了コード体系**（0/1/2/3/4）を踏襲。worktree は使用法・環境・git 失敗をすべて **exit 1** に集約し、
  詳細は git のメッセージで伝える（新コードを足さない）。

## 対象範囲

- `.aidev/bin/aidev`（POSIX sh）: `usage()` ヘッダ追記 ＋ `cmd_worktree()` 追加 ＋ dispatch に `worktree)` 追加。
- `.aidev/bin/aidev.ps1`（PowerShell）: 同等実装（出力・終了コード一致）。
- `.aidev/bin/test/run.sh`: worktree ケース追加。
- `.aidev/bin/README.md`: コマンド表に `worktree` 行追加。
- `.claude/skills/aidev-00-start/protocol.md`: worktree 節（人間オプトイン / current は worktree ローカル /
  1 worktree=1 branch=1 work / INV-1）を追記。

## インターフェース / データ構造

### サブコマンド・ディスパッチ

```
aidev worktree <add|list|rm> ...
```

`cmd_worktree()` 内で第1引数 sub を見て `wt_add` / `wt_list` / `wt_rm` に振る。未知 sub は exit 1。

### `aidev worktree add <slug> [options]`

| オプション | 既定 | 意味 |
|---|---|---|
| `--branch <name>` | `feature/<slug>` | 作成ブランチ。**git に必ず `-b` で明示**（research F4: branch 省略は path basename 命名のため使わない） |
| `--base <ref>` | 現在 HEAD | 分岐元 |
| `--path <dir>` | `<dirname ROOT>/<basename ROOT>-wt/<slug>` | worktree 設置先（リポジトリ外の兄弟） |
| `--mode <m>` | `interactive` | 新規 work 作成時に `new` へ渡す |
| `--ticket <ID>` | （無し） | 新規 work 作成時に `new` へ渡す |
| `--depends <list>` | （無し） | 新規 work 作成時に `new` へ渡す |

手順:
1. `command -v git >/dev/null` でなければ exit 1。`<slug>` 必須（無ければ usage, exit 1）。
2. ブランチ・パス・base を既定/オプションで確定。
3. ブランチ存在判定:
   - 既存ブランチ → `git worktree add "<path>" "<branch>"`（`-b` なし＝既存をチェックアウト）。
   - 未存在 → `git worktree add -b "<branch>" "<path>" "<base>"`。
   - git の**実 exit code** が非 0 なら、git のメッセージをそのまま見せて exit 1
     （path 衝突・同一ブランチ二重 checkout=research F5・権限エラー等を一括処理）。
4. worktree 内で work を確定（**main tree の `.aidev/current` には触れない**＝INV-1）:
   - worktree 側 `works/*/state.yml` の中に `slug: <slug>` を持つ work が
     - **ちょうど1つ** → その dated フォルダ名を worktree 側 `.aidev/current` に書く（current 設定のみ）。
     - **複数** → 曖昧として exit 1（`--work <dir>` での明示を促す。将来拡張）。
     - **0個** → worktree をカレントにして `new <slug> [--mode --ticket --depends]` 相当を実行
       （`( cd "<path>" && "$0" new "<slug>" ... )`。`new` が worktree の `.aidev` を `find_root` で解決し、
       採番・state/metrics 初期化・worktree 側 current 設定を行う）。
5. 結果サマリと**規約警告**（後述）を出力。exit 0。

> 既存 work 継続は「その work の成果物が**コミット済み**で worktree のブランチに乗っていること」が条件
> （research リスク1: 未コミット work folder は worktree に伝播しない）。既定運用は 0個→`new`＝「add 内で new」。

### `aidev worktree list [--format table|tsv]`

- `git worktree list --porcelain` を解析し、各 worktree の `worktree`（path）・`branch` を得る。
- 各 path の `.aidev/current`（**worktree ローカル**）が存在するものを「aidev 管理」とみなす（research F1/F3）。
  存在すれば slug を読み、`works/<slug>/state.yml` の `current:` から工程を得る。
- 列: `path` / `branch` / `work`（current の指す dated 名 or `-`）/ `phase`（工程 or `-`）。
- 既存 `status` 同様 `fmt_table` を使い、`--format tsv` を提供（先頭列 `path`）。**読み取り専用**。

### `aidev worktree rm <slug>|<path> [--force] [--delete-branch]`

1. 対象 worktree 解決: 引数が既存ディレクトリなら path、それ以外は `git worktree list` から
   path basename が `<slug>` または branch が `feature/<slug>` の worktree を引く（曖昧/不在は exit 1）。
2. 未コミット差分チェック: 対象 worktree で `git -C "<path>" status --porcelain` が非空かつ `--force` 無し → exit 1
   （差分があるので止める旨を表示）。
3. `git worktree remove ["--force"] "<path>"`（実 exit code 判定）。worktree 内の未追跡 `.aidev/current` も消える。
4. `--delete-branch` 指定時のみ `git branch -D "<branch>"`（既定はブランチを残す）。
5. **main の `.aidev/current` は不変**（INV-1）。exit 0。

### `usage()` ヘッダ追記（先頭コメント）

```
#   aidev worktree add <slug> [--branch n] [--base ref] [--path dir] [--mode m] [--ticket id] [--depends list]
#   aidev worktree list [--format table|tsv]
#   aidev worktree rm <slug|path> [--force] [--delete-branch]
```

### add 完了時の規約警告（必ず出力）

```
⚠ この work が package.json(contributes) / src/fileScope.ts / 言語登録に触るなら、
  他 worktree と languageId 波及・マージ衝突が起きうる（AGENTS.md「languageId 下流波及」）。
  並行可否の判断はユーザー責任。
⚠ CL/RPG プロンプター定義など原典照合が要る work は主エージェント実施が必須（委譲して検証を落とさない）。
次: cd <path> して各工程 skill を実行。
```

## 振る舞いの詳細 / エッジケース

- `add` の `<path>` は親ディレクトリ作成を git に委ねる（git worktree add が中間ディレクトリを作る）。失敗は exit 1。
- ブランチ既存だが他 worktree で checkout 済み → git が `fatal: already used by worktree`（research F5）→ exit 1。
- `list` で `.aidev/current` はあるが指す work dir が無い → `work` 列は current 値、`phase` は `-`（壊さない）。
- `rm` の slug 解決で複数該当 → exit 1（path 明示を促す）。
- すべての git 呼び出しは**実 exit code を直接判定**（`if git ...; then` 形式。パイプ経由で判定しない）。

## ドメイン固有の考慮（AGENTS.md）

- **languageId 波及**: 本機能自体は表示系/言語登録を変えないが、worktree 上で行う作業が共有ファイル
  （`package.json` contributes・`fileScope.ts`・言語登録）に及ぶ場合の波及をユーザーに想起させる警告を必須化。
- **原典照合は主エージェント実施**: 並行作業でも委譲して検証を落とさない旨を警告に明記。
- **CLI 設計規約**（README）: 単一検証経路の維持（work 作成は `new` に委譲）・Node 非依存・ps1 パリティ・終了コード一致。

## エラー処理 / 異常系（exit code）

| 事象 | code |
|---|---|
| 正常 | 0 |
| git 不在 / 使用法 / 未知 sub・option / slug 不足 / 解決曖昧・不在 | 1 |
| `git worktree add` 失敗（path 衝突・二重 checkout・権限） | 1（git メッセージ表示） |
| `rm` で未コミット差分あり＋`--force` 無し | 1 |

worktree 専用の新コードは導入しない（既存 0/1/2/3/4 を踏襲、worktree は 1 に集約）。

## 受け入れ基準との対応

| requirement の受け入れ基準 | spec での充足 |
|---|---|
| add で feature/<slug>＋外部 path worktree、current=slug | `wt_add` 手順 2–4（既定 path/branch、0個→`new` が current 設定） |
| 既存 work は new せず current 設定のみ | 手順 4「ちょうど1つ」分岐 |
| add 後 main current 不変（INV-1） | INV-1 を全手順で明記。research F1 で成立。テストで before/after assert |
| add 完了時に規約警告 | 「add 完了時の規約警告」を必須出力 |
| list が current 有無で aidev 管理を抽出 | `wt_list` 判定キー = worktree ローカル `.aidev/current` の有無 |
| rm の未コミット拒否 / --force / --delete-branch | `wt_rm` 手順 2–4 |
| git 不在・衝突・使用法で exit 1 | エラー処理表 |
| ps1 が sh と出力・終了コード一致 | 対象範囲に aidev.ps1、設計方針でパリティ明記 |
| usage / README / protocol 追記 | 対象範囲に明記 |

## design(任意) 判定

- 単一 CLI モジュールへの局所追加で、設計判断は design 書（`.aidev/design/aidev-worktree.md`）＋ research で
  既に確定済み。複数コンポーネント横断・新アーキ判断・複雑データモデルのいずれにも該当しない。
- → **design は不要**。plan へ進む。
