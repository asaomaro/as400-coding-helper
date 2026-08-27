# 計画: 条件つきの `COLOR` / `DSPATR` を条件として扱う

## 作業順序と依存関係
1. `KeywordGroup` と `LogicalUnit.keywordGroups`（依存: なし）
2. `keywords` と `keywordGroups` の連結が一致することをテストで固定（依存: 1）
3. `PlacedItem` / `PlacedSource` / `RenderItem` に載せる（依存: 1）
4. `resolveAppearanceUnder`（依存: 1）
5. `applyIndicators` で見え方を作り直す（依存: 4）
6. プロパティに条件つきキーワードを出す（依存: 3）
7. e2e に操作の検査を足す（依存: 6）

## リスク / 留意点
- `unit.keywords` の意味を変えない（5 か所が読んでいる）。
- `applyIndicators(model, {})` の同一参照返しを壊さない。
- 継続行（`-` / `+`）は既に代表行へ吸収済み。**継続とキーワードだけの行を混同しない。**

## テスト方針
- `keywords === keywordGroups.map(g => g.keywords).join(" ").trim()` を全サンプルで固定。
- 標識を 3 値で倒し、見え方が変わる／変わらないを見る。
- **直す前に戻して落ちることを確かめる。**
- e2e で実際に標識を倒して反転表示が消えることを見る。
