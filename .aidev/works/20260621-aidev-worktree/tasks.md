# タスク: `aidev worktree` 実装

- [x] T1: `bin/aidev` 骨格 — `usage()` ヘッダに worktree 3 行追記 ／ dispatch に `worktree) cmd_worktree "$@" ;;` 追加 ／ `cmd_worktree()` で sub(add|list|rm) 振り分け（未知 sub は exit 1）
- [x] T2: `bin/aidev` `wt_add` 実装（依存: T1）— git 存在チェック・既定 branch=`feature/<slug>`/base=HEAD/path=外部兄弟・既存/新規ブランチで `-b` 分岐・**実 exit code 判定**・worktree 内 work 確定（slug一致 0個→`new`委譲 / 1個→current設定 / 複数→exit1）・規約警告出力・**main current 不変(INV-1)**
- [x] T3: `bin/aidev` `wt_list` 実装（依存: T1）— `git worktree list --porcelain` 解析・判定キー=worktree ローカル `.aidev/current` 有無・列 path/branch/work/phase・`--format table|tsv`・読み取り専用
- [x] T4: `bin/aidev` `wt_rm` 実装（依存: T1）— slug/path 解決・未コミット差分は既定拒否＋`--force`・`git worktree remove` 実 exit code 判定・`--delete-branch` 時のみブランチ削除・**main current 不変(INV-1)**
- [x] T5: `bin/aidev.ps1` 追従実装（依存: T2,T3,T4）— worktree add/list/rm を sh と挙動・出力・終了コード一致で実装・usage 追記・パス/既定path のみ OS 吸収（pwsh 不在のためランタイム未検証＝decisions.md D3）
- [x] T6: `bin/test/run.sh` に worktree ケース追加（依存: T2,T3,T4,T5）— add 生成物 / **INV-1 before-after** / 規約警告 / 異常系 exit1 / list 抽出・tsv / rm 拒否・force・delete-branch / 後始末（$TMP 配下フィクスチャで自動掃除）。全35件 pass
- [x] T7: `bin/README.md` のコマンド表に `worktree add|list|rm` 行を追加（依存: T2,T3,T4 の確定 surface）
- [x] T8: `protocol.md` に worktree 節（1.5）を追記（依存: T2,T3,T4 の確定 surface）— 人間オプトイン / current は worktree ローカル / 1 worktree=1 branch=1 work / INV-1（main current 不変）/ 既存継続は要コミット
