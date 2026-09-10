# タスク: 罫線を引けるようにする（DSPF / PRTF）

## 実装方針

`architecture.md` の横割り順序（パーサー/ビルダー → RenderModel 統合 → UI → 原典/検査）で進める。
DSPF と PRTF のパーサー/ビルダー（T4, T5）は互いに独立しており、原典・検査系（T1-T3）とも
依存が薄いので、並行して着手できる（`design.md`/`architecture.md` で確定済みの方針は
ここでは繰り返さない）。

subtask には分割しない（tasks 工程で判定済み。DSPF/PRTF で縦割りにすると UI/RenderModel の
共通部分を二重に割ることになるため）。

## 作業順序と依存関係

下の `依存:` に従う。補足するのは1点だけ——**T1-T3（原典・検査）は T4 以降と機械的な依存が
無いが、AC5（罫線・枠の単体テストが原典と一致すること）は T1-T3 の結果を必要としない**
（T4/T5 が直接引用するのは research.md に転記済みの原典の生テキストであり、
`resources/completion/dds-keywords.json` の反映を待たない）。

## リスク / 留意点

- T5（PRTF パーサー/ビルダー）着手時に `PrintDensity` 型の実際のエクスポート形と、
  `FRONTMGN`/`BACKMGN` の解決状況を先に確認する（`design.md`「未確認 / coding で確かめること」）。
  見立てと違えば `decisions.md` に記録してから進める。
- T2 で GRDATR の「ファイル・レベルまたはレコード・レベル」という複数レベル表記が
  `generate-dds-keyword-levels.mjs` の既存の抽出ロジックで正しく解決されるか確認する
  （AGENTS.md の既知の罠「長い語から先に消さないと過剰に付く」と同種の危険がある）。
- T9（罫線ツール）は既存のドラッグ/矢印キー実装（`ui.ts:358,2686,2957`）に相乗りするため、
  既存のフィールド移動・リサイズの挙動を壊さないことを都度確認する。

## テスト方針

- 単体テスト: `ddsGridShapes.ts` のパーサー/ビルダーを原典の生テキスト（research F2/F3）と
  直接照合する（AC5）。`RenderModel` 統合（`gridLines`/`gridBoxes` の反映、`GRDCLR`/`GRDRCD`
  が描画に現れないこと＝D4/D5）も単体テストで固定する。
- e2e（単独起動ハーネス）: 罫線ツールでの配置・削除・undo・キーボード操作・フォーカスの
  行き先（AC4, AC6, AC-I1〜I5）。`20260908-dds-new-and-records` の e2e と同じ形で追加する。
- 原典照合: `verify-dds-keyword-index-coverage.mjs`（AC7）を `npm run verify` に組み込む。

## タスク

- [x] T1: DSPF の GRD 系5キーワード（GRDLIN/GRDBOX/GRDATR/GRDCLR/GRDRCD）を `sources.mjs` に
      登録し、`dspkwd.htm`（DBCS考慮事項の章）を2次索引として登録する。実機（ja/en）から
      5ページずつ取得し `docs/origin/dds/detail/` `docs/origin/dds-en/detail/` に保存する。
      対象: `docs/origin/sources.mjs`（DSPF セクション）／根拠: research F1（URL確定済み）
      依存: なし
      AC: AC1
- [x] T2: `generate-dds-keywords.mjs` を、2次索引（`dspkwd.htm`）由来のリンクも
      `KEYWORD_LINK` と同じ形で拾えるように拡張し、GRD 系5件を
      `resources/completion/dds-keywords.json` に反映する。反映後に
      `generate-dds-keyword-levels.mjs` を再実行し、レベル抽出（GRDATR の複数レベル表記を含む）
      が正しく解決されることを確認する。
      対象: `docs/origin/generate-dds-keywords.mjs`
      依存: T1
      AC: AC1
- [x] T3: 索引外キーワードの取りこぼしを検出する検査（`verify-dds-keyword-index-coverage.mjs`
      新設、または `verify-dds-keywords.mjs` の拡張）を作る。取得済み詳細ページ
      （`docs/origin/dds/detail/*.htm`）と生成済み JSON を突き合わせ、個別キーワード名を
      ハードコードしない形にする。
      対象: 未特定（`docs/origin/verify-dds-keywords.mjs` の既存パターンを読んでから設計）
      依存: T2
      AC: AC7
- [x] T4: `ddsGridShapes.ts`（新設）に DSPF 側のパーサー/ビルダー
      （`parseGrdlin`/`buildGrdlin`、`parseGrdbox`/`buildGrdbox`）を実装する。
      対象: `src/core/dds/ddsGridShapes.ts`（新規）／参照: `ddsKeywords.ts:65 parseKeywordEntries`
      依存: なし
      AC: AC5
- [x] T5: `ddsGridShapes.ts` に PRTF 側のパーサー/ビルダー
      （`parsePrtfLine`/`buildPrtfLine`、`parsePrtfBox`/`buildPrtfBox`）を実装する。
      着手時に `PrintDensity` 型の実際の形と `FRONTMGN`/`BACKMGN` の解決状況を確認する。
      対象: `src/core/dds/prtfDensity.ts`（型確認）、`src/core/dds/ddsGridShapes.ts`
      依存: なし
      AC: AC5
- [x] T6: `dspfRenderModel.ts` の `RenderModel` に `gridLines`/`gridBoxes` を追加し、
      `GRDLIN`/`GRDBOX` の occurrence を T4 のパーサーで読み取って反映する。
      対象: `src/core/dds/dspfRenderModel.ts:109`（`RenderModel`）
      依存: T4
      AC: AC2
- [x] T7: `prtfRenderModel.ts` に同様の統合を行う（`BOX`/`LINE` を CPI/LPI 変換込みで読み取る）。
      対象: `src/core/dds/prtfRenderModel.ts`／参照: `prtfLayout.ts:277`, `prtfDensity.ts:21`
      依存: T5
      AC: AC3
- [x] T8: `RenderModel.gridLines`/`gridBoxes` をキャンバスに描画する（配置操作はまだ無い、
      読み取り専用の可視化）。
      対象: `src/dds/webview/ui.ts`（新規描画ロジック）
      依存: T6
      AC: AC2, AC3
- [x] T9: 罫線ツール（配置 UI）: ドラッグ/Shift+矢印キーでの範囲選択、Enter/マウスアップでの
      確定、Escape での取り消し。確定時に T4/T5 のビルダーを呼び、既存の `setKeywords` を発行する。
      対象: `src/dds/webview/ui.ts:358`（`pointerdown`）、`ui.ts:2686`（`dragTarget`）、
      `ui.ts:2957`（矢印キー差分テーブル）
      依存: T8
      AC: AC4, AC-I1, AC-I2, AC-I3
- [x] T10: 配置後の焦点制御（新しく置いた罫線・枠へ焦点を移す。取り消したらツールボタンへ）。
      `20260908-dds-new-and-records` の `pendingSelectRecord`/`pendingRecordFocus` と同じ
      「選ぶ」と「焦点を移す」を分けるパターンを踏襲する。
      対象: `src/dds/webview/ui.ts`
      依存: T9
      AC: AC-I4
- [x] T11: 罫線ツール中のキー入力（矢印キー・Enter・Escape）が、選択中の他項目の編集キーへ
      漏れないことを実装・確認する。
      対象: `src/dds/webview/ui.ts`
      依存: T9
      AC: AC-I5
- [x] T12: 削除（✕チップ）: 罫線・枠をチップとして表示し、既存のキーワード・チップ削除と
      同じ経路（現在の全文から対象を除いて `setKeywords`）で削除する。
      対象: `src/dds/webview/ui.ts`（既存のキーワード・チップ UI を参照）
      依存: T8
      AC: AC6
- [x] T13: 単体テスト: `ddsGridShapes.ts` のパーサー/ビルダーを原典の生テキスト
      （research F2/F3）と直接照合する。
      対象: `test/unit/ddsGridShapes.test.ts`（新規）
      依存: T4, T5
      AC: AC5
- [x] T14: 単体テスト: `RenderModel` 統合（`gridLines`/`gridBoxes` の反映、`GRDCLR` が
      描画に影響しないこと＝D4、`GRDRCD` が `gridLines`/`gridBoxes` に現れないこと＝D5）。
      対象: 既存の `dspfRenderModel`/`prtfRenderModel` の単体テストファイルに追記
      依存: T6, T7
      AC: AC2, AC3
- [x] T15: e2e（単独起動ハーネス）: 罫線ツールでの配置・削除・undo・キーボード操作・
      フォーカスの行き先・既存操作を妨げないことを確認する。
      対象: `dev/e2e.mjs`
      依存: T9, T10, T11, T12
      AC: AC4, AC6, AC-I1, AC-I2, AC-I3, AC-I4, AC-I5
