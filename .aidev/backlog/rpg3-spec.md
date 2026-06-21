---
backlog: rpg3-spec
kind: standing        # standing（定常ドメインキュー）| split（タスク分割由来・短命）
priority: 3           # 複数backlog選択順（小さいほど先）
---
# RPG III(RPG/400) 仕様書 定義バックログ（**RPG III スコープ**）

> **スコープ: RPG III(RPG/400)**。本バックログの定義はすべて `rpg3` 方言
> （`resources/prompter/rpg/rpg3/`）が対象。ILE(RPG IV) の定義は `rpg-spec.md` で管理する。
> 方言分離の基盤は #18 で整備済み。

`aidev-batch` が消化する対象リスト。各未チェック行 = 1件のタスク（autonomous aidev の requirement）。
RPG III 固定長フォーマットの仕様書（Spec）ごとのプロンプター定義 JSON を作成する。
**桁位置は ILE と異なる**ため、RPG III 原典（固定長フォーマットリファレンス）の生テキストと
機械的に照合して確定すること（AGENTS.md「開発時の検証規約」）。

参照（原典・grounded）:
- 既存 `vscode-extension/resources/prompter/rpg/rpg3/C-SPEC.json`（#18 で原典照合済みのスキーマ実例）
- 桁照合の根拠例: `.aidev/works/20260620-rpg-dialect-split/research.md`（C-spec 桁の rpg006/rpg007 直読）
- スキーマの正は `vscode-extension/src/prompter/types.ts`

## 定義対象（`vscode-extension/resources/prompter/rpg/rpg3/<X>-SPEC.json`）

- [x] C-SPEC — 演算仕様書（#18 で最小1定義として作成・原典照合済み）
- [x] H-SPEC — 制御/ヘッダー仕様書（#46 / 20260621-rpg3-spec-defs・rpg002 桁照合）
- [x] F-SPEC — ファイル記述仕様書（#46 / rpg002 桁照合・6-72桁確定）
- [x] I-SPEC — 入力仕様書（#46 / rpg002 桁照合・レコード+フィールド統合）
- [x] O-SPEC — 出力仕様書（#46 / rpg002 桁照合・レコード+フィールド統合）
- [ ] E-SPEC — 拡張仕様書（rpg010 直読が必要。原典確定後に追加）
- [ ] L-SPEC — 行カウンター仕様書（rpg010 直読が必要。原典確定後に追加）

> C/H/F/I/O は #46（20260621-rpg3-spec-defs）で原典(rpg002)照合のうえ実装。
> E/L は rpg010(Advanced statement types) の桁直読が必要なため後続で追加する。
