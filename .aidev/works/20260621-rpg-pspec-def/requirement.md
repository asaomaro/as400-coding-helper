# 要件: P-SPEC（プロシージャー仕様書）プロンプター定義の新設

> 出典: backlog `.aidev/backlog/rpg-spec.md`「P-SPEC (needs: #19)」。#19 マージ済＝依存充足。batch(autonomous)。

## 目的 / ゴール
- ILE P 仕様書のプロンプター定義 `rpg/ile/P-SPEC.json` を原典（`docs/ILE_RPG_Fixed_Format_Reference.md` L788-807）
  準拠で新設する。F4 配線は前作業の分類単一化で既に有効（P→"P-SPEC" 解決済み）。

## スコープ
- 対象: `P-SPEC.json` 生成（プロシージャー名・B/E・キーワード欄。B/E は dropdown、キーワードは keyword 方式）。
- 対象外: rpg3 の P-SPEC。配線（前作業で対応済み）。

## 完了条件
- [ ] `P-SPEC.json` が原典 L788-807 と桁一致・`types.ts` 準拠・JSON パース可。
- [ ] backlog の P-SPEC を `[x]` 化。
