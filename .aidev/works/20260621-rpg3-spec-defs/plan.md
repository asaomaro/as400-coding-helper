# 計画: RPG III 仕様書定義（H/F/I/O）

## 実装方針

research.md の grounded 桁表を正に、ile 同型定義のパターンで rpg3 桁の H/F/I/O を作成。E/L は backlog 追跡。
各定義は作成後に「桁が research.md（=rpg002 原典）と一致するか」を主エージェントが機械照合し、構造検証スクリプトで適合確認。

## 作業順序と依存関係

1. T1 backlog 追記（依存なし）
2. T2 H-SPEC（最小）（依存なし）
3. T3 F-SPEC（6-30確定＋33-72 を rpg002 再精読で確定／不能なら保留）（依存なし）
4. T4 I-SPEC（レコード+フィールド統合）（依存なし）
5. T5 O-SPEC（レコード+フィールド統合）（依存なし）
6. T6 桁の原典機械照合＋構造検証 green＋backlog [x]（依存: T1–T5）

## リスク / 留意点

- **桁の推測補完禁止**: 原典に無い桁は欄ごと保留（F-SPEC の一部）。research.md に記録。
- 桁は方言で異なる→ ile からの流用禁止。research.md（rpg3 原典）の値のみ使用。
- languageId 波及なし（データ追加のみ）。
- F4 実機検証は headless 不可 → 構造健全性で代理担保。

## テスト方針

- 構造検証 `validate-prompter-defs.mjs`（rpg 走査）で全 rpg3 定義が `PrompterDefinition` 適合。
- 桁機械照合: 各 JSON の sourceStart/Length を research.md の表（=原典）と突合。
- 既存 ile/rpg3 定義への非回帰（基盤不変）。
