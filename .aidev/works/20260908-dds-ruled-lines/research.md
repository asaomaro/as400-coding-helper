# 調査: 罫線を引けるようにする（DSPF / PRTF）

## 調査の問い

- Q1: DSPF の GRD 系キーワード（索引に無い）の原典はどこにあるか。
- Q2: PRTF の `BOX`/`LINE` の原典と構文の詳細は何か。既存の補完データで足りるか。
- Q3: DSPF の `GRDLIN`/`GRDBOX` の位置指定は、既存キャンバス（行・桁のグリッド）と同じ座標系か。
- Q4: PRTF の `BOX`/`LINE` の位置指定は、既存キャンバスと同じ座標系か。
- Q5: 座標系が異なる場合、変換に使えるロジックは既にあるか。
- Q6: 既存の描画モデル（`RenderModel`/`RenderItem`）はどう拡張の余地があるか。
- Q7: 既存キャンバスのドラッグ/リサイズ実装はどこにあり、罫線配置の UI に転用できるか。
- Q8: 罫線の追加・削除を表す編集コマンドはどこに足すことになるか。

## 判明した事実

### F1（Q1）: GRD 系キーワードの原典は「DBCS に関する考慮事項」の章の下にある

現在ローカルに取得済みの原典（`docs/origin/dds/`）には GRD 系 4 キーワードの詳細ページが
**1 件も存在しない**（`grep -rli grdlin\|grdbox\|grdatr\|grdclr docs/origin/` は
`FIELD-DSPF-pos38.html`（本文中の言及のみ）しか当たらない）。

実機の索引ページ（`https://www.ibm.com/docs/ja/ssw_ibm_i_74/rzakc/rzakcmstkeyent.htm`）を
直接取得して確認したところ、**GRD で始まるキーワードは実際に 1 件も掲載されていない**
（索引側の欠落であって、取得スクリプトの取りこぼしではない）。

原典のトップページ（`kickoff.htm`）の章立てを取得したところ、キーワード索引とは**別の
独立した章**として「DDS の 2 バイト文字セット (DBCS) に関する考慮事項」
（`rzakcmstzdbcs.htm`）があり、その子ページ「DBCS を使用する表示装置ファイルのための
キーワードに関する考慮事項」（`dspkwd.htm`）に **GRD 系キーワードへのリンクが実在する**。

`dspkwd.htm` の実リンク一覧（取得済み）:

| キーワード | href |
|---|---|
| GRDATR | `rzakcmstdfgrda.htm` |
| GRDBOX | `rzakcmstdfgrdb.htm` |
| GRDCLR | `rzakcmstdfgrdc.htm` |
| GRDLIN | `rzakcmstdfgrdl.htm` |
| **GRDRCD**（未知の5件目） | `rzakcmstdfgrdr.htm` |
| CNTFLD | `dbcscn.htm` |
| IGCALTTYP | `rzakcmstzigcalt.htm` |
| IGCCNV | `rzakcmstigccnv.htm` |

**requirements.md には無かった発見: `GRDRCD`（グリッド・レコード）という 5 件目のキーワードが
同じ経路から見つかった。** CNTFLD/IGCALTTYP/IGCCNV も同じ穴（索引外）に落ちているが、
罫線とは無関係なので本 work の対象外（AC7 の機械検査が拾えば別途 backlog 化する）。

各ページの URL は `https://www.ibm.com/docs/ja/ssw_ibm_i_74/rzakc/<href>`
（英語版は `dds-en/` と同じ locale 差し替えの経路。既存の `sources.mjs` の
パターンをそのまま使える）。全ページ生存確認済み（2026-09-10 実機フェッチ）。

### F2（Q1）: GRDLIN/GRDBOX/GRDATR/GRDCLR/GRDRCD の構文（原典から直読）

いずれも**レコード・レベル・キーワード**（`GRDATR` のみファイル・レベルまたはレコード・レベル）。

| キーワード | 構文（要点） | 有効値 |
|---|---|---|
| `GRDLIN` | `GRDLIN((*POS([*DS3][*DS4] start-line start-column length) [(*TYPE type [repeat] [interval])] [(*COLOR color)] [(*LINTYP type)] [(*CONTROL)])` | TYPE: UPPER/LOWER/RIGHT/LEFT（文字セルの上/下/右/左の境界線） |
| `GRDBOX` | `GRDBOX((*POS([*DS3][*DS4] start-row start-column depth width)) [(*TYPE type [hrule] [vrule])] [(*COLOR)] [(*LINTYP)] [(*CONTROL)])` | TYPE: PLAIN(既定)/VRT/HRZ/HRZVRT |
| `GRDATR` | `GRDATR([(*COLOR color)] [(*LINTYP type)])` | COLOR 16色 / LINTYP 7種（SLD/THK/DBL 等） |
| `GRDCLR` | `GRDCLR[(*POS([*DS3][*DS4] start-row start-column depth width))]` | パラメータ省略時は**全グリッド線を消去** |
| `GRDRCD` | パラメータ無し。**このレコードをグリッド専用レコードにする宣言**で、許可される
      キーワードが `DSPMOD, FRCDTA, GRDATR, GRDBOX, GRDCLR, GRDLIN, RETKEY, RETCMDKEY,` `RMVWDW, USRRSTDSP, WDWBORDER, WDWTITLE, WINDOW` に限定される |

**`GRDLIN`/`GRDBOX`/`GRDCLR` の位置指定は行番号・桁（`start-line`/`start-column`/
`start-row`/`start-column`）で、`GRDBOX`/`GRDCLR` は `depth`（行方向の大きさ）・
`width`（桁方向の大きさ）を持つ**——**単位はどちらも文字グリッドの行・桁**（既存キャンバスと同じ座標系。cm/inch ではない）。

`GRDRCD` は座標を持たず「このレコードは grid 専用」という**宣言だけ**。個々の線・枠の座標は
同じレコード内に置く `GRDLIN`/`GRDBOX` 側が持つ。

### F3（Q2）: PRTF の `BOX`/`LINE` の原典は取得済み・座標系は cm/inch

原典（`docs/origin/dds/detail/rzakd_rzakdmstptbox.htm` / `rzakdmstptline.htm`。
2021-04-13 取得）から直読。

- `BOX(first-corner-down first-corner-across diagonal-corner-down diagonal-corner-across line-width [color])`
  ——4 隅ではなく「対角の 2 点」＋線幅。**全パラメータ必須**。
- `LINE(position-down position-across line-length line-width line-direction [line-pad] [color])`
  ——始点＋長さ＋方向（`*HRZ`/`*VRT`）＋線幅。
- **単位は cm/inch**（`CRTPRTF` の `UOM` パラメータに従う）。有効範囲は
  「0 から 57.790 cm (0 から 22.750 インチ)」。**行・桁（文字グリッド）ではない。**
- 既存の補完データ（`resources/completion/dds-keywords.json` の `BOX`/`LINE` エントリ）は
  `syntax` が**先頭の引数だけ**で打ち切られている（要約用の簡略形。フル定義ではない）。
  AC5 で「原典と照合して確定」する対象は、原典の生テキスト
  （`docs/origin/dds/detail/rzakd_rzakdmstptbox.htm` 等）であって、この JSON ではない。

**DSPF と PRTF で座標系がまったく違う**——これが本 work でいちばん重い技術的事実。

### F4（Q5）: cm/inch ↔ 文字グリッドの変換ロジックは既にある（新規に作らなくてよい）

`src/core/dds/prtfLayout.ts` の `Cursor` 型（`prtfLayout.ts:68,277-280`）は、
**行番号と物理位置（`inches`）の両方を既に持つ**——LPI がページ途中で変わると
行番号と位置が比例しなくなるため（原典の実測例が `prtfLayout.ts:262-299` に引用済み）。

横方向も同様に `src/core/dds/prtfDensity.ts` が CPI（1 インチ当たりの文字数）を
解決する（`prtfDensity.ts:21`「幅（インチ）＝桁数 ÷ CPI」とコメントで明記）。

**つまり「cm/inch → 行・桁」の変換に使う入力（有効な LPI/CPI）はここから取れる。**
BOX/LINE を描画モデルに載せる際、独自の単位変換を新設するのではなく、
この 2 ファイルの解決ロジックを再利用する前提で設計できる。

### F5（Q6）: 既存の `RenderModel` / `RenderItem` の構造

`RenderModel`（`src/core/dds/dspfRenderModel.ts:109-140`）は
`items: readonly RenderItem[]`（配置できた項目）と `records: readonly string[]`
（様式の一覧）を持つ。`RenderItem`（`src/core/dds/ddsRenderItem.ts:45-48`）の
`kind` は現在 `"field" | "constant"` の 2 種のみで、**単一の行・桁・長さ**を前提にした形
（`toRenderItem`、`ddsRenderItem.ts:171`）。

GRDBOX/BOX のような「複数行×複数桁にまたがる矩形」は、この形にそのまま当てはまらない
（`depth`/`width` のような**2次元の広がり**を持つ項目が今は存在しない）。
GRDLIN/LINE のような「1 行 or 1 桁だけの直線」は既存の `RenderItem` に近いが、
**境界線の向き**（GRDLIN の `UPPER`/`LOWER`/`RIGHT`/`LEFT`）という、
既存のどの項目も持たない属性を追加で持つ。

`RenderModel` は DSPF/PRTF 共通（`kind: "dspf" | "prtf"` で分岐。`dspfRenderModel.ts:110`）
なので、罫線・枠を**共通の形**で持たせるか種別ごとに分けるかは design の論点になる。

**window（`WINDOW`/`WDWBORDER`）は現状まったく視覚描画されていない**
（`grep -rn "WDWBORDER\|border" src/core/dds/dspfRenderModel.ts src/dds/webview/ui.ts` は
UI 側のポインタ座標計算がヒットするのみ）。「窓の枠線描画で罫線描画を賄えないか」という
発想は成立しない——流用元が存在しない。

### F6（Q7）: 既存キャンバスのドラッグ/リサイズ実装

`src/dds/webview/ui.ts` に、フィールドの配置・移動・リサイズを担う一式が既にある。

- `Mode` 型に `"dragging" | "resizing"` が存在（`ui.ts:69`）。
- ポインタ操作の起点は `pointerdown`（`ui.ts:358`）とリサイズ用のグリップ（`ui.ts:2065`）。
- ドラッグ中の対象セル計算は `dragTarget`（`ui.ts:2686`）。
- **キーボード等価物が既にある**：矢印キーで 1 セルずつ移動（`ui.ts:2957-2975` の
  `ArrowUp/Down/Left/Right` → `{row, column}` の差分テーブル）。

**「ドラッグで罫線・枠を置く」は既存の操作様式と地続き**——GRDBOX/GRDLIN の
「行・桁・（あれば）depth/width」は、既存のフィールド配置・リサイズが扱っている
「行・桁・長さ」と同じ種類の量。矢印キーでの等価操作も同じ枠組みで作れる可能性が高い
（design で具体化）。

**PRTF 側は cm/inch なので、ドラッグの「1 セル」が何 cm に当たるかは F4 の CPI/LPI 変換を
経由しないと意味を持たない**——PRTF の罫線配置 UI は DSPF よりも一段複雑になる。

### F7（Q8）: 編集コマンド（`DdsEdit`）と protocol の拡張点

- `DdsEdit` の判別共用体は `src/core/dds/ddsEdit.ts:87` から始まる。直近の前例
  （`addRecord`/`removeRecord`）もここに追加された。
- webview ⇔ ホストの契約は `src/dds/webview/protocol.ts` の `parseEdit`
  （`addRecord`/`removeRecord` のケースが `protocol.ts:187-198` にある）。
  新しい edit kind（罫線・枠の追加/削除）はここに型のみのケースを足す形になる
  （`20260908-dds-new-and-records` と同じ形）。

## 影響範囲

- `src/core/dds/dspfRenderModel.ts` / `ddsRenderItem.ts`（描画モデルへの罫線・枠の追加）
- `src/core/dds/prtfLayout.ts` / `prtfDensity.ts`（PRTF の cm/inch 変換の再利用）
- `src/core/dds/ddsEdit.ts` / `ddsEditWriteBack.ts`（罫線・枠の追加・削除の編集コマンド）
- `src/dds/webview/protocol.ts` / `ui.ts`（配置 UI・キャンバス描画・キーボード操作）
- `docs/origin/sources.mjs` / `generate-dds-keywords.mjs` / `verify-dds-keywords.mjs`
  （GRD 系＋GRDRCD の原典追加、索引外キーワードの取りこぼし検査）
- `resources/completion/dds-keywords.json`（GRD 系キーワードの新規追加）

## 実現性 / リスク

- **DSPF 側（GRDLIN/GRDBOX/GRDCLR）は座標系が既存キャンバスと同じ**（行・桁）ため、
  技術的な壁は低い。既存のフィールド配置・リサイズの延長として設計しやすい。
- **PRTF 側（BOX/LINE）は座標系が cm/inch**で、既存キャンバスの行・桁グリッドと直接は噛み合わない。
  幸い変換に使う仕組み（LPI/CPI の解決）は既にあるため「ゼロから作る」リスクは無いが、
  **UI 上のドラッグ 1 セル分が何 cm に相当するかを常に再計算する**設計が要る。
  DSPF と同じ手離れの良さは期待できない。
- **`RenderItem` が単一行・単一桁の項目しか知らない**ため、`depth`/`width` を持つ
  矩形（GRDBOX/GRDCLR の範囲指定・BOX）をどう表現するかは design で決める必要がある
  （新しい `kind` を足すか、`RenderModel` に別配列を持たせるか）。
- **`GRDRCD` は座標を持たない宣言的キーワード**なので、AC2/AC4（描画・配置）の対象には
  そのままでは当てはまらない。AC1（データ反映）の対象には含めるべきだが、
  「プレビュー上に線・枠として描く」対象では**ない**——design で扱いを明確にする。
- GRD 系ページのタイトルはすべて「〜の DBCS に関する考慮事項」という奇妙な体裁だが、
  **本文には通常の構文・レベル・有効値がフルに含まれている**（DBCS 専用の断片ではない）。
  生成スクリプト側でこのタイトル文字列を鵜呑みにして「DBCS 注記」として除外しないよう注意
  （実装時の注意に再掲）。

## 実装アンカー

- A1: 描画モデルへの罫線・枠の追加（DSPF）:
  `src/core/dds/dspfRenderModel.ts:109`（`RenderModel` 定義）、
  `src/core/dds/ddsRenderItem.ts:45`（`RenderItem` 定義・`kind` の拡張候補）
- A2: PRTF の cm/inch 変換ロジックの再利用箇所:
  `src/core/dds/prtfLayout.ts:277`（`Cursor.inches`/`lpi`）、
  `src/core/dds/prtfDensity.ts:21`（CPI による桁⇔インチ換算の既存コメント）
- A3: 編集コマンドの追加:
  `src/core/dds/ddsEdit.ts:87`（`DdsEdit` 判別共用体）、
  `src/dds/webview/protocol.ts:187`（`addRecord`/`removeRecord` の前例と同じ位置）
- A4: キャンバスの操作（ドラッグ・リサイズ・キーボード）:
  `src/dds/webview/ui.ts:358`（`pointerdown`）、`ui.ts:2686`（`dragTarget`）、
  `ui.ts:2957`（矢印キーの差分テーブル）
- A5: 原典取得スクリプトの拡張（未特定 — `docs/origin/sources.mjs` の `dds` セクションに
  `dspkwd.htm` 経由のエントリを足す具体的な書き方は coding 側で `sources.mjs` の
  既存パターンを読んでから決める）

## 実装時の注意

- **GRD 系ページのタイトル文字列（「〜の DBCS に関する考慮事項」）を「DBCS 専用」と
  誤読しない。** 本文は通常のキーワード定義そのもの。
- **索引に無いキーワードは `dspkwd.htm` 経由でも取れる**が、この経路自体も
  「DBCS 考慮事項の章からしか辿れない」という別の索引外れである点は変わらない。
  AC7 の検査は「索引（`rzakcmstkeyent.htm`）に無いキーワードが `dds-keywords.json` に
  存在する」ことを許容しつつ、**取得元が変わっても機械検査が拾える形**にする
  （個別キーワード名をハードコードした検査にしない）。
- **PRTF の cm/inch を row/column に丸めて表示する場合、丸め誤差で複数の罫線が
  同じセルに重なる可能性がある**——既存の重なり判定（`overlapsUnderIndicators` 等、
  DSPF 側にある概念）が PRTF 側にどこまで転用できるかは未確認（design で検討）。
- `GRDRCD` を持つレコードは「許可されるキーワードが限定される」——通常のフィールド追加操作を
  誤ってこのレコードに向けると、原典が定める制約（`DSPMOD, GRDATR, GRDBOX, ...` 以外禁止）に
  違反したソースを書きかねない。バリデーションの要否は design で判断する。

## design への申し送り

- `RenderModel`/`RenderItem` の拡張方法（新しい `kind` を足すか、`lines`/`boxes` を
  別配列にするか）は未確定。**DSPF は行・桁で完結するが PRTF は cm/inch を介する**という
  非対称を踏まえて決める。
- `GRDRCD` を requirements の対象（AC1: 原典・データ）に含めるか、
  「グリッド専用レコード」という**別概念**として別 work に切り出すかは design で判断する。
  少なくとも「描画・配置 UI（AC2-AC4）の対象ではない」ことは research で確定した。
- PRTF の罫線配置 UI（ドラッグ 1 セル＝何 cm か）の具体的な UX は、
  DSPF 用の UI が固まった後に検討したほうが手戻りが少ない可能性がある
  （tasks の split 判定で「DSPF 先行・PRTF 後続」の順序も選択肢にできる）。
- 索引外キーワードの機械検査（AC7）は、この work の対象外である CNTFLD/IGCALTTYP/IGCCNV も
  副産物として拾う設計にする（拾った後の扱いは backlog 送りでよい。仕様を広げすぎない）。
