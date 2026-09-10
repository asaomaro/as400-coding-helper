# レビュー記録

## ラウンド 1（2026-09-10）

`aidev coverage` は tasks 承認時と完全一致（gap 0・`design`/`tasks` とも 12/12）。
design と実装の乖離なし。

実作業の優先順位（protocol.md「2.5」）に従い、(1) 自己点検（要件適合・価値適合・規約適合・
正確性・保守性の全観点）と (2) 組み込み `code-review`（正確性・保守性を高負荷度で併用）の
両方を実施した。**指摘はすべてこの場で修正**し、再検証まで完了している
（正式な `sent_back` は打っていない——理由は下記「メトリクスの読み方」参照）。

### 自己点検で見つけた指摘

- [should][conv:-] `generate-dds-keyword-levels.mjs` の再実行漏れ — `dds-keywords.json`
  に GRD 系5件を反映した後、T2 で計画していたはずの `generate-dds-keyword-levels.mjs` の
  再実行を失念していた。`resources/completion/dds-keyword-levels.json` に GRD 系のレベル
  情報が反映されておらず、`keywordLevelDiagnostics`（レベル違反の lint）がこの5件を
  一切判定できない状態だった。「一覧に無いものは咎めない」設計のため誤検知は生まないが、
  検知すべき違反を見逃す。 / 対応: 再実行して解消（GRDATR: [file, record] / 他4件:
  [record] を確認）。全テスト・`npm run verify` を再実行し regression 無しを確認。
  — `vscode-extension/resources/completion/dds-keyword-levels.json`
- [nit][conv:-] `removeGridShape`（ui.ts）が `readGridShapes`/`collectDspfGridShapes` と
  同種の「キーワード名→パーサー」対応付けを別の場所に再実装している。目的が違う
  （raw テキストの保持が要る）ため許容範囲だが、GRD系キーワードが増えたとき片方だけ
  更新される再発リスクは残る。 / 対応: 記録のみ（今回は見送り）。
  — `vscode-extension/src/dds/webview/ui.ts:removeGridShape`
- [nit][conv:-] プログラム-システム間フィールド（`&名前`）による可変位置の罫線・枠が
  静かに描画対象から外れる（クラッシュはしない）。design/requirements のどちらも
  可変位置を想定しておらず、対応も求めていない。 / 対応:
  test-result.md の「未検証の穴」に明記。follow-up 候補。

### 組み込み `code-review`（high・正確性/保守性）の指摘

指摘は6件。**すべてコードを読んで再現条件を直接確認したうえで対応**（機械的な受け入れはしていない）。

- [must][conv:-] `screenModel()`（ui.ts）が 2 次画面へ切り替えるとき
  `canvas`/`items`/`diagnostics` は差し替えるが `gridLines`/`gridBoxes` を差し替えていない
  ——2次画面を見ていても罫線・枠は常に1次の位置のまま描かれ、選択して削除しようとしても
  `removeGridShape` の内部比較（`screenTarget: "secondary"` で再解決した値との一致判定）が
  食い違って**黙って何も起きない**。/ 対応: `secondary.gridLines`/`gridBoxes` を差し替えに追加。
  回帰テスト: `dev/e2e.mjs`「2次に切り替えると罫線も2次の位置で描かれる」「2次画面で選択した
  罫線をDeleteで削除できる」（新設サンプル `grid-two-sizes.dspf`）。
  — `vscode-extension/src/dds/webview/ui.ts:586-598`
- [must][conv:-] `selectPrintPage()`（PRTF）が `items` はページで絞るが、
  `RenderGridLine`/`RenderGridBox` は `page` フィールド自体を持たず絞りようが無かった
  ——複数ページの帳票で、ある1ページにしかない BOX/LINE が**全ページに重複して描かれる**。
  / 対応: `RenderGridLine`/`RenderGridBox` に任意の `page` を追加し、`fromPrtfLayout` で
  同じ様式の項目が解決したページを borrow して刻む（項目 0 件の様式は既定でページ1、
  `item.page ?? 1` と同じ既定）。`selectPrintPage` で絞るように修正。
  回帰テスト: `dev/e2e.mjs`「1ページ目にはBOXが出ない」「2ページ目にはBOXが出る」
  （`multi-page.prtf` サンプルの PAGE2 に BOX を追加）。
  — `vscode-extension/src/core/dds/prtfRenderModel.ts`、`ddsGridShapes.ts`
- [should][conv:-] `submitGridShape()` が始点と終点が完全に同じ点でも
  「1行×1桁」を横罫線として扱い、長さ1の罫線を黙って書いていた（`rowMin === rowMax` の
  判定が退化した1点クリックを弾いていない）。/ 対応: `confirmGridPoint()` で始点と終点が
  同じ点なら確定させず、終点の選び直しを促す（ツールは armed のまま）。
  回帰テスト: `dev/e2e.mjs`「始点と同じ点を2回目に選んでも何も置かれない」。
  — `vscode-extension/src/dds/webview/ui.ts:confirmGridPoint`
- [should][conv:-] `readPositionNumbers()` が `*DS3`/`*DS4` の組の値が崩れている
  （個数不足・非数値）ときも無条件に `i += count` していたため、直後にある**正しい**組の
  マーカーごと読み飛ばすことがある（`*DS3 3 10 *DS4 5 15 8` で実際に再現）。
  / 対応: 値を実際に消費できた（有効だった）ときだけ `i += count` するよう修正。
  回帰テスト: `ddsGridShapes.test.ts`「崩れた*DS3組の後ろにある正しい*DS4組を読み飛ばさない」
  （break-test で修正前に確実に再現することも確認済み）。
  — `vscode-extension/src/core/dds/ddsGridShapes.ts:readPositionNumbers`
- [nit][conv:-] `buildGridLineElement`/`buildGridBoxElement` が「選択中のものと同じ実体か」の
  判定（4項目の比較）を重複して持つ。/ 対応: `isSelectedGridShape()` に共通化。
  — `vscode-extension/src/dds/webview/ui.ts`
- [nit][conv:-] `.aidev/config.yml` の smoke コマンドが同じ CLI 呼び出しを2回（grep ごとに1回）
  実行していた。/ 対応: 出力を1度だけ変数に captureして2回grepする形に修正。
  — `.aidev/config.yml`

### メトリクスの読み方（数字をそのまま読むと誤る）

前回 work（`20260908-dds-new-and-records`）の retro が指摘した「レビュアーと実装者が
同一のとき、差し戻しの記録が実態を表せない」がここでも再現している。**指摘6件（must 2 /
should 2 / nit 2）は review 工程の中で見つけ、その場で修正・再検証まで完了した**が、
`sent_back` は記録していない——coding へ戻して踏み直す形ではなく、この工程の作業時間帯に
そのまま直しているため。件数は `aidev approve review must=2 should=2 nit=2` として刻むが、
**所要時間は review 工程に寄っており、coding には反映されない**（前回と同じ形）。

## 判定

**指摘は計9件（must 2 / should 3 / nit 4）**。**must・should の5件はすべて対応済み**
（回帰テスト付き）。nit 4件のうち2件（選択判定の重複の共通化・smokeの二重実行）は対応、
残り2件（`removeGridShape`の重複・`&名前`可変位置）は記録のみに留める判断。
要件適合・価値適合・規約適合の観点で新たな指摘はない（`aidev coverage` gap 0、
AGENTS.md の主要規約——原典照合・生成スクリプト経由・戻して落ちる確認——はいずれも遵守）。

`walkthrough.md` を作成する（差分の大きさ・複数モジュール横断・処理フローの複雑さの
3条件すべてに該当するため）。
