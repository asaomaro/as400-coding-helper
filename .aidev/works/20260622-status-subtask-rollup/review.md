# レビュー記録

## ラウンド 1（2026-06-22）

観点: 要件適合 / 正確性 / 規約適合（sh/ps1 パリティ）/ 回帰。主エージェントが sh⇔ps1 を直接突合。

- [確認] 要件適合: 既定で親 next=`sub N/M`（未完時）、`--subtasks` で子の current/done を table（インデント）/
  tsv（`subtask` 行型）に展開。全完了時は統合工程（test/review/deliver）の次を表示。spec の受け入れ基準を満たす。
- [確認] パリティ: tsv W 行（work+7列）/ tsv S 行（subtask\t親/子\tcurrent\tdone）/ table S 行（`  ↳ …`）/
  next 上書きロジック / subtasks 列挙順 が sh・ps1 で一致（生テキスト突合）。
- [確認] 回帰: subtasks を持たない work の table/tsv 出力は不変（型タグ W は同一7列を emit）。
  実 repo で `sub`/`↳` 混入0・tsv work 行8フィールドを確認。TSV `work` 行のフィールド数・順序は不変。
- [確認] 読み取り専用: state を変更しない（既存 subtasks/子 approved/子 current の読み取りのみ）。
- [nit] 全完了時の next は「従来 pipeline next」ではなく統合工程（test/review/deliver）の次に精緻化
  （split 親は coding を子が実施するため `coding` を出さないのが正）。spec の意図どおりで対応不要。

must/should なし（nit 1・対応不要）。

## 未検証 surface（deliver へ引き継ぐ）
- **sh⇔ps1 パリティ（skip=1）**: ローカル pwsh 不在。`status --subtasks --format tsv` のパリティ節を追加済み。
  CI（pwsh 同梱 runner）での実行検証が必須。
