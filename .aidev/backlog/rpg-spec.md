---
backlog: rpg-spec
kind: standing        # standing（定常ドメインキュー）| split（タスク分割由来・短命）
priority: 2           # 複数backlog選択順（小さいほど先）
---
# RPG仕様書 定義バックログ（**ILE / RPG IV スコープ**）

> **スコープ: ILE(RPG IV)**。本バックログの定義はすべて `ile` 方言（`resources/prompter/rpg/ile/`）が対象。
> RPG III(RPG/400) の定義は別バックログ `rpg3-spec.md` で管理する（#18 で方言分離済み）。

`aidev-util-batch` が消化する対象リスト。各未チェック行 = 1件のタスク（autonomous aidev の requirement）。
RPG 固定長フォーマットの仕様書（Spec）ごとのプロンプター定義 JSON を作成する。

参照（原典・grounded）:
- `docs/ILE_RPG_Fixed_Format_Reference.md`（固定長フォーマットの桁位置リファレンス）
- 既存 `vscode-extension/resources/prompter/rpg/ile/{C-SPEC,C-NEW,D-SPEC}.json`（スキーマ実例）
- スキーマの正は `vscode-extension/src/prompter/types.ts`

## 定義対象（`vscode-extension/resources/prompter/rpg/ile/<X>-SPEC.json`）

- [x] D-SPEC — 定義仕様書（既存）
- [x] C-SPEC — 演算仕様書（従来形式・既存）
- [x] C-NEW — 演算仕様書（新形式・既存）
- [x] H-SPEC — 制御仕様書（ヘッダー）（aidev-batch 試走で生成・PR feature/rpg-hspec）
- [x] F-SPEC — ファイル仕様書のプロンプター定義JSONを作成（#19 rpg-spec-def skill 新設時にドッグフードで生成・原典 L159-171 照合済み）
- [x] I-SPEC — 入力仕様書のプロンプター定義JSONを作成（batch: 原典 L503-515 照合済み＋F4配線。20260621-rpg-ispec-def）
- [x] O-SPEC — 出力仕様書のプロンプター定義JSONを作成（batch: 原典 L745-762 照合済み。20260621-rpg-ospec-def）
- [ ] P-SPEC — プロシージャー仕様書のプロンプター定義JSONを作成 (needs: #19)

> 各行のタスクは「<X>-Spec の定義JSONを作成」。固定長の桁位置は仕様種別で異なるため、
> 参照リファレンスと既存定義を正に、`types.ts` 準拠でマッピング・検証する。
> （CL の `cl-command-def` に相当する RPG 用の支援 skill を別途用意すると効率的。）
