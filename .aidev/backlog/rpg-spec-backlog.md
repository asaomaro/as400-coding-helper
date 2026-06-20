# RPG仕様書 定義バックログ

`aidev-batch` が消化する対象リスト。各未チェック行 = 1件のタスク（autonomous aidev の requirement）。
RPG 固定長フォーマットの仕様書（Spec）ごとのプロンプター定義 JSON を作成する。

参照（原典・grounded）:
- `docs/ILE_RPG_Fixed_Format_Reference.md`（固定長フォーマットの桁位置リファレンス）
- 既存 `vscode-extension/resources/prompter/rpg/{C-SPEC,C-NEW,D-SPEC}.json`（スキーマ実例）
- スキーマの正は `vscode-extension/src/prompter/types.ts`

## 定義対象（`vscode-extension/resources/prompter/rpg/<X>-SPEC.json`）

- [x] D-SPEC — 定義仕様書（既存）
- [x] C-SPEC — 演算仕様書（従来形式・既存）
- [x] C-NEW — 演算仕様書（新形式・既存）
- [x] H-SPEC — 制御仕様書（ヘッダー）（aidev-batch 試走で生成・PR feature/rpg-hspec）
- [ ] F-SPEC — ファイル仕様書のプロンプター定義JSONを作成
- [ ] I-SPEC — 入力仕様書のプロンプター定義JSONを作成
- [ ] O-SPEC — 出力仕様書のプロンプター定義JSONを作成
- [ ] P-SPEC — プロシージャー仕様書のプロンプター定義JSONを作成

> 各行のタスクは「<X>-Spec の定義JSONを作成」。固定長の桁位置は仕様種別で異なるため、
> 参照リファレンスと既存定義を正に、`types.ts` 準拠でマッピング・検証する。
> （CL の `cl-command-def` に相当する RPG 用の支援 skill を別途用意すると効率的。）
