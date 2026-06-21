# 要件: O-SPEC（出力仕様書）プロンプター定義の新設

> 出典: backlog `.aidev/backlog/rpg-spec.md`「O-SPEC (needs: #19)」。#19 マージ済＝依存充足。batch(autonomous)。

## 目的 / ゴール
- ILE O 仕様書のプロンプター定義 `rpg/ile/O-SPEC.json` を原典（`docs/ILE_RPG_Fixed_Format_Reference.md` L745-762）
  準拠で新設する。F4 配線は前作業 20260621-rpg-ispec-def の分類単一化で既に有効（O→"O-SPEC" 解決済み）。

## スコープ
- 対象: `O-SPEC.json` 生成（原典の桁位置表＝レコード行を写像、`types.ts` 準拠、タイプ H/D/T/E は dropdown）。
- 対象外: フィールド明細行専用プロンプト（代表行＝レコード行）。rpg3 の O-SPEC。配線（前作業で対応済み）。

## 完了条件
- [ ] `O-SPEC.json` が原典 L745-762 と桁一致・`types.ts` 準拠・JSON パース可。
- [ ] backlog の O-SPEC を `[x]` 化。
