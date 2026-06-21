# テスト記録: rpg-spec-def skill ＋ F-SPEC(ILE) ドッグフード

検証日時: 2026-06-21（UTC）。plan.md「テスト方針」の4点＋回帰＋配線を検証。原典照合は主E直読。

## 結果サマリ: passed=6 / failed=0（＋環境不足 skip 1件）

| # | 受け入れ観点 | 方法 | 結果 |
|---|---|---|---|
| (a) | JSON パース可・回帰なし | `node require` で rpg/{ile,rpg3}/*.json 全6件 | **PASS**（F-SPEC 追加後も全件 PARSE OK） |
| (b) | 既存定義と同型・types.ts 準拠 | トップキー比較（D-SPEC と一致）＋全 param キーが `ParameterDefinition` 許容キー内 | **PASS**（TOP KEYS MATCH / unknown キーなし） |
| (c) | 桁位置・required・options が原典一致 | 原典 `docs/ILE_RPG_Fixed_Format_Reference.md` L159-171 を**主E再直読**し JSON と機械突合 | **PASS**（11欄すべて桁一致。I/O/U/C・E/F・DISK 等の定義済み値も L177-204 と一致） |
| (d) | skill 自己完結・委譲可能 | frontmatter(name/description/allowed-tools)＋節構成＋research/coding委譲記述を確認 | **PASS**（出力先/原典参照[非対称]/マッピング/手順/aidev連携 すべて存在） |
| (e) | ランタイム配線（実用性） | `ruler.ts:321` が F 行→`"F-SPEC"`、`jsonDefinitions.ts` が `keyword` 大文字で索引 | **PASS**（新 `keyword:"F-SPEC"` が F4 プロンプター経路に配線。従来 F 行に定義不在だった穴が埋まる） |
| (f) | TypeScript 回帰なし | `npx tsc -p ./ --noEmit` | **PASS**（TSC OK・型エラーなし。TS 変更なし） |

## 環境不足で skip した検証（deliver へ引き継ぐ）

- **ユニット/結合テスト未実行**: `vscode-extension/package.json` の `test` は `echo "Tests are not configured…"`
  のプレースホルダで、`test/unit/*.test.ts`・`test/integration/*.test.ts` を走らせるランナーが本環境に未設定。
  → これらは**未実行（環境依存の未検証 surface）**。本変更は JSON リソース＋skill md＋tsc クリーンで、
  ランタイム配線はコード直読（(e)）で確認済みのためリスクは低いが、**全数検証ではない**点を PR の既知の制約に載せる。

## 観察（スコープ外・後続向け）

- `ruler.ts` の specChar switch に **`case "I"` が無い**（I 行が種別未分類）。後続の I-SPEC backlog 消化時は
  ruler 側の分類追加も併せて要検討（本作業のスコープ外＝F-SPEC のみ）。
