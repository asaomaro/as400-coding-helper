# テスト記録: I-SPEC ＋ プロンプター配線の単一化

検証日時: 2026-06-21（UTC）。原典照合は主E直読。passed=5 / failed=0（環境不足 skip 1）。

| # | 観点 | 方法 | 結果 |
|---|---|---|---|
| (a) | JSON パース・回帰なし | `node require` で rpg/**/*.json 全件 | **PASS**（ALL PARSE OK） |
| (b) | types.ts 準拠・dropdown options | 許容キー検査・dropdown options 有無 | **PASS**（schema OK） |
| (c) | 桁位置が原典一致 | 原典 L503-515 を主E再直読し I-SPEC 11欄と機械突合 | **PASS**（7-16/17-18/19-20/21-41/43-46/47-51/52/53-58/59-68/69-74 すべて一致） |
| (d) | 配線（ruler＋F4＋タブナビ） | `ruler.ts`＋`positionResolver.ts` が共有 `classifyRpgSpecKeyword` で I→"I-SPEC" 解決。tsc クリーン | **PASS**（重複削除・TSC OK） |
| (e) | 単一化で挙動不変 | ruler=dialect非依存／prompter=dialect依存(C新旧) を共有関数で保持。既存テスト参照なし＝破壊なし | **PASS** |

## 環境不足 skip（deliver 引き継ぎ）
- ユニット/結合テスト未実行（runner 未設定）。`specClassifier` の単体テストは vscode 依存で headless 実行不可のため未追加。
  → runner 整備時に classifier テスト追加を推奨（PR の既知の制約に記載）。
