# 計画: SNDPGMMSG 定義JSON作成

前提: spec.md

## 実装方針
spec のマッピング表に従い、`cl/CALL.json` をテンプレに `cl/SNDPGMMSG.json` を1ファイル生成。
PJ skill `cl-command-def`（coding 委譲先）の手順3–5（JSON組立・検証）に沿う。

## 作業順序と依存関係
1. JSON 生成（11パラメータをマッピング表どおり） （依存: なし）
2. JSON 妥当性・スキーマ整合の検証 （依存: 1）
3. 平坦化等の設計判断を decisions.md に記録 （依存: 1）

## リスク / 留意点
- TOPGMQ 平坦化により原典のネスト構造を完全再現しない（help で補足）。
- 定義済み値が help 依存になる（enum欄なし）。

## テスト方針
- `node -e` で JSON パース可能を確認。
- 既存 `cl/CALL.json` と同一キー構造（inputType/children/attributes 等）であること。
- 11パラメータが揃い、型/必須/反復/修飾が research（原典）と一致すること。
