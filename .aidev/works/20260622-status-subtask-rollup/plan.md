# 計画: aidev status の subtask ロールアップ表示

## split 判定
小規模・低結合（`cmd_status`/`Cmd-Status` の表示ロジック局所変更）。subtask 分割不要、単一サイクル。

## 実装方針
sh 正本 → ps1 → テスト の順。既存 work 行の出力バイト不変を最優先（回帰ゼロ）。

## 作業順序
1. sh `cmd_status`: 親の subtasks 集計（N/M）と未完時の `next`=`sub N/M` 上書き。
2. sh `cmd_status`: `--subtasks` 引数と子展開（table インデント行 / tsv `subtask` 行型）。
3. ps1 `Cmd-Status`: 1–2 と挙動一致（`@()` で配列強制・単一要素アンラップ回避）。
4. `test/run.sh`: subtask 集計・`--subtasks`・回帰（subtask 無し work は不変）・パリティ節。

## リスク / 留意点
- **回帰**: subtasks を持たない work の table/tsv をバイト不変に保つ（既存テストで担保）。
- **TSV 後方互換**: `work` 行は8フィールド固定。子は別行型 `subtask`（4フィールド）で追加。
- **sh/ps1 パリティ罠**: ps1 単一要素配列アンラップ（子1件時）→ `@()` 強制。`set -eu` の列挙関数は末尾 `return 0`。
- N/M 算出は子 state.yml 読み取りのみ（読み取り専用維持）。

## テスト方針
- 親(subtasks 2件・1件 review 済) → 既定 `next`=`sub 1/2`、`--subtasks` で子2行（current/done）。
- 全完了(N==M) → `next` が pipeline 値に戻る。
- subtasks 無し work → 既存 status 出力が不変（回帰アサート）。
- sh⇔ps1 パリティ（`status --subtasks --format tsv`）を CI で突合。
