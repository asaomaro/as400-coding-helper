# レビュー記録

## ラウンド 1（2026-06-20T09:10:00Z）

### 総評

requirement の完了条件・spec の設計方針・AGENTS.md のドメイン規約に整合。実装は周辺コード
（`dbcsShiftMarkers.ts` 等）のスタイルを踏襲し、桁ローダの共通化（`keywordColumns.ts`）も
単一真実源化として妥当。tsc 通過・桁計算検証済み・ソース非破壊を確認。**must は 0 件**。

### 指摘一覧

- [should] `src/language/ruler.ts` `setFloating`（描画方式）/ 対応: 実機確認待ち（修正対象未確定）
  - `before` 擬似要素を `position: absolute; top: <em>; left: 0` で行上に浮かせる手法は、
    位置決めの基準（最近接 positioned 祖先）次第で水平／垂直のズレが起き得る。spec/research が
    「best effort・実機で top 調整」と明記した既知リスク（decisions D1）。test 工程も UI 目視は
    手動残として承認済み。
  - 対応方針: deliver 後（または review→deliver 間）に実 VSCode（F5 起動）で目視確認。ズレる場合の
    フォールバックとして `position: absolute` の代わりに `display: inline-block; transform: translateY(-100%)`
    ＋行を基準にする手法へ切替を検討（実機フィードバック前提のため、現時点でのコード変更は見送り）。

- [should] コンパイル成果物 `out/` の同期 / 対応: deliver で対応
  - 本 PJ は `out/`（tsc 出力）をリポジトリ管理対象としている（`main: ./out/extension/extension.js`）。
    新規 `out/language/ruler.js` `keywordColumns.js` は未追跡、`out/utils/fileScope.js` に既存ズレを検出。
  - 対応方針: deliver 工程で `npm run compile` 後の `out/` を漏れなくステージし、src と整合した状態で
    コミットする（コード修正ではなく着地時の運用事項）。

- [nit] `ruler.ts` / `positionResolver.ts` の `cNewOpcodes` ロジック重複（decisions D2）
  - 既定集合＋設定キーは一致させてあるが、将来の変更時に 2 箇所同期が要る。共通ヘルパへの
    抽出を follow-up 候補に。許容（決定済み）。

- [nit] 非アクティブ in-scope エディタの stale デコレーション
  - 別の in-scope エディタへ切替えた際、前エディタの最終フォーカス行装飾が残り得る（非表示・非アクティブ
    のため実害なし。再アクティブ時に `setDecorations` で置換され正常化）。許容。

- [nit] spec 文言「コメント行（6 桁目 `*`）」と実装「7 桁目 `*`」の差（decisions D3）
  - 実フォーマット／既存 `rpgTabNavigation` 規約に合わせ実装は 7 桁目を採用。spec 文言を実装へ
    追従修正する余地（次回 spec 更新時）。許容。

### 判定

- must: 0 / should: 2 / nit: 3
- should 2 件はいずれも **deliver・実機での対応事項**（コードの即時修正を要する欠陥ではない）。
  S1 は実機フィードバック前提で修正対象が未確定、S2 は deliver 時のビルド成果物コミット運用。
  → coding への差し戻しは行わず、両 should を deliver/実機の TODO として持ち越し、deliver へ進むことを推奨。
