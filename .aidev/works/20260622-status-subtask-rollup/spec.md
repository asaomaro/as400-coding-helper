# 仕様: aidev status の subtask ロールアップ表示（案C）

## 用語
- **親**: top-level work（`works/<dated>/`）で `state.yml` の `subtasks` が非空のもの。
- **完了数 N / 総数 M**: M=`subtasks` の要素数、N=各子 `works/<親>/<子>/state.yml` の `approved` に
  `review` を含む数（子サイクルは review 承認で完了）。

## 1. 既定表示（フラグなし）

列構成は**現状維持**（`work / ticket / mode / current / next / done / deps`）＝**TSV のフィールド数を変えない**
（機械消費の後方互換）。subtask を持つ親についてのみ `next` 列の意味を切り替える:

- 親が subtasks を持ち、**未完（N<M）** → `next` = `sub N/M`（pipeline 由来の誤った `coding` を上書き）。
- **全完了（N==M）** → 従来どおり pipeline 由来の `next`（親の統合 test→review→deliver が actionable）。
- subtasks を持たない work → **従来の挙動のまま**（回帰なし）。
- `done` 列は不変（親は `deliver` 承認で yes）。subtask 行は既定では出さない。

例:
```
work                    ticket  mode         current  next     done  deps
20260622-feat           -       interactive  plan     sub 2/3  no    ok
```

## 2. `--subtasks` 展開表示

`aidev status --subtasks`（`--format` と併用可）で、subtasks を持つ親の**直後に子を列挙**する。

- **table**: 子を同じ列構造のインデント行として親の下に出す（`fmt_table` で整列）。
  - `work` セル = `  ↳ <NN-subslug>` / `current` = 子の `current`（工程）/ `done` = 子の review 承認で `yes`,他 `no`
  - `ticket`/`mode`/`next`/`deps` は `-`。
  ```
  work                    ticket  mode         current  next     done  deps
  20260622-feat           -       interactive  plan     sub 2/3  no    ok
    ↳ 01-backend          -       -            review   -        yes   -
    ↳ 02-frontend         -       -            coding   -        no    -
    ↳ 03-docs             -       -            plan     -        no    -
  ```
- **tsv**: 子を**新しい行型 `subtask`** で出す（既存の `work`/`backlog` 行型と同列の方式）。
  - `subtask<TAB><親>/<子><TAB><子current><TAB><子done(yes|no)>`（4フィールド）。
  - 既存の `work` 行（8フィールド）は不変＝**既存 tsv 消費は壊れない**。
- フラグなしのときは子行を出さない（既定の簡潔表示）。

## 3. 引数仕様
- `--subtasks`: ブール。子展開を有効化。
- 既存 `--format table|tsv` と独立に併用可。未知オプションは従来どおり exit 1。

## 4. 実装対象
- `cmd_status`（sh）/ `Cmd-Status`（ps1）。両者で出力一致。
- 子の状態は既存 `subtasks`/子 `approved`/子 `current` から導出（新 state 追加なし・読み取り専用）。

## 5. 受け入れ基準
- subtasks を持つ親で既定 `next`=`sub N/M`（未完時）、`--subtasks` で子の工程・完了が見える。
- subtasks を持たない work の table/tsv 出力は**バイト一致で不変**（回帰）。
- 既存 tsv の `work` 行のフィールド数・順序は不変。
- sh⇔ps1 パリティ（`--subtasks` 込み）が CI で一致。
- 全完了（N==M）の親は従来 pipeline next に戻る。
