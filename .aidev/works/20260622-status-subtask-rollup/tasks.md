# タスク: aidev status の subtask ロールアップ表示

- [x] T1: sh `cmd_status` に親 subtasks 集計（N/M）＋未完時 `next`=`sub N/M` 上書き（全完了は統合工程 test/review/deliver の次）
- [x] T2: sh `cmd_status` に `--subtasks` 引数＋子展開（table インデント行 / tsv `subtask` 行型・型タグ W/S）
- [x] T3: ps1 `Cmd-Status` を T1–T2 と挙動一致（`@()` 配列強制・型タグ分岐）
- [x] T4: `test/run.sh` に集計・`--subtasks`・回帰（subtasks 無し不変）・パリティ節（status --subtasks）を追加
