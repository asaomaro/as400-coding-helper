# 要件: aidev status の subtask ロールアップ表示

## 背景 / 課題

`aidev status` は `works/*/`（直下）だけを走査し、各 work の `current`/`next`/`done` を
親の `approved` から STD_PIPELINE で算出する。subtask 層（`works/<親>/<NN>-<subslug>/`）導入後、
**subtask に分割した親 work の進捗が status から把握できない**:

- subtask 行が一切出ない（ネストは glob `works/*/` に載らない）。
- 親の `next` が pipeline 計算で `coding` 等になり、**実態（subtask が実装する）と食い違う**。
- 「3 subtask 中 2 完了、いま 02 が coding」という進捗が見えない。

`doctor` は subtask 横断するよう既に更新済みだが、`status` は未対応。

## ゴール

`aidev status` で subtask 分割した親 work の進捗を**ロールアップ表示**し、必要時に内訳も見られる。

## スコープ（案C：サマリ既定＋フラグ展開）

- **既定**: subtasks を持つ親 work の行に、subtask 進捗サマリ（完了数/総数）を表示する。
- **`--subtasks`**: 各親の subtask を**インデント子行**（table）/ `subtask` 型行（tsv）で展開する。
- 対象は `cmd_status`（sh）/ `Cmd-Status`（ps1）。table / tsv 両フォーマット。
- `aidev status` は**読み取り専用**（state を変更しない）を維持。

## スコープ外

- `metrics` / `doctor` の表示変更（doctor は既に横断済み）。
- 新しい state フィールドの追加（既存 `subtasks`/`activeSubtask`/子 `approved` から導出）。
- subtask の多段ネスト（単層前提のまま）。

## 完了条件

- subtasks を持つ親 work で完了数/総数が既定表示される。
- `--subtasks` で子の `current`（工程）と完了状態が確認できる。
- subtask を持たない既存 work の表示は**不変**（回帰なし）。
- sh/ps1 で出力一致（パリティテストで担保）。
- 既存 status のテストが壊れない。
