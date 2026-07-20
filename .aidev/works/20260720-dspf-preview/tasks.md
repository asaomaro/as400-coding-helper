# タスク: DSPF 画面プレビュー（DBCS 対応）

## 第 1 段: 共有部品の切り出し（振る舞い不変・各タスクの完了条件は `npm test` 全通過）

- [x] T1: `core/dds/prtfColumns.ts` を `core/dds/ddsPositionColumns.ts` に改名し、
      `PRTF_POSITION_ROW`/`PRTF_POSITION_COLUMN` を `DDS_POSITION_ROW`/`DDS_POSITION_COLUMN` に
      改める。参照元（`prtfLayout.ts`・`prtfWriteBack.ts`）の import を更新。
      **`DDS_COLUMNS` からの導出のしかたには触れない**（R1）。
      確認: `contributesSideEffects.test.ts` を名指しで通す。
- [x] T2: `core/dds/prtfWriteBack.ts` を `core/dds/ddsPositionWriteBack.ts` に改名し、
      参照元（`prtfPreview.ts`）と `test/unit/prtfWriteBack.test.ts` の import を更新（依存: T1）。
      確認: 実サンプル全行の恒等性テストが通る（R7）。
- [x] T3: `toLogicalUnits` / `LogicalUnit` / `readConstant` / `readNumber` を
      `prtfLayout.ts` から `core/dds/ddsLogicalUnits.ts` へ移設。
      キーワード欄の起点 `44` のハードコードを `DDS_COLUMNS` 由来の定数に昇格させる。
      条件付けの前置き行の判別も足す（decisions D2）。
      既存テストは移さず、共有モジュールに新規の単体テストを足す（decisions D1）。
- [x] T4: 幅の解決（定数=`printWidth` / 29桁`R`=参照 / `EDTCDE` / 長さ欄 / `+n` 増減形）を
      `prtfLayout.ts` から `core/dds/ddsFieldWidth.ts` へ移設し、`WidthUnknownReason` も移す（依存: T3）。
      既存テストは移さず、共有モジュールに新規の単体テストを足す（decisions D1）。

## 第 2 段: DSPF 固有の純粋関数（vscode 非依存）

- [x] T5: `core/dds/dspfScreenSize.ts` を実装（依存: T3）。
      `*DS3`=24×80 / `*DS4`=27×132、数値指定、条件名（IBM 提供・ユーザー定義 2-8 文字先頭`*`）、
      1 次/2 次、`DSPSIZ` 省略時は 24×80・`declared=false`。
      不正値・3 つ以上は診断を返して既定で続行。
      テスト `dspfScreenSize.test.ts`（spec の 5 書式＋異常系）。
- [x] T6: `core/dds/ddsConditioning.ts` を実装（依存: T3）。
      7-16 桁を `none` / `indicators`（7桁目 A|O・`N` 否定・複数行にまたがる AND）/
      `screen-size`（8 桁目から・先頭 `*`）に判別。`isMutuallyExclusive` は spec の表のとおり
      **保守的**（両方 `none` のときだけ「排他でない」）。
      テスト `ddsConditioning.test.ts`。
- [x] T7: `core/dds/dspfLayout.ts` を実装（依存: T4, T5, T6）。
      `resolveDspfLayout(lines): DspfLayout`（純粋関数・例外を投げない）。
      - 位置欄 39-41/42-44 の解決。**位置が無ければ配置しない**（`missing-position`）。
        `+n` は `relative-position-unresolved` を出して描画対象から外す。
      - **属性文字の占有** `occupancy = [column-1, column+width]`。幅不明時は `end=column`（R2）。
      - 診断: `overlap`（同一レコード様式内・端点一致は許す・`isMutuallyExclusive` で抑止）/
        `overflow` / `invalid-position` / `column-one-reserved` / `missing-position` /
        `relative-position-unresolved` / `invalid-screen-size`。
      - 画面サイズ条件名が 1 次と一致しない項目は**配置せず診断も出さない**。
      テスト `dspfLayout.test.ts`（合成ソースで属性文字占有・1 桁目・重なりの誤検出なし＝R4）。

## 第 3 段: 描画と殻

- [x] T8: `language/dspfPreviewHtml.ts` を実装（依存: T7）。
      `buildDspfPreviewHtml(layout, options): string`。vscode を import しない。
      桁は `--cell` の整数倍で絶対配置、画面の箱が権威で `overflow:hidden`、
      上端に `buildRuler(columns)`、`data-source-line`/`data-row`/`data-column`、`.active`、
      **属性文字の桁を淡色マーカーで描く**、幅不明は破線枠 1 桁、
      未解決の件数を上部に注記（幅不明 / `+n` / キーボードシフト / 2 次画面あり）。
      CSP と nonce は PRTF と同形。`.length` による桁計算を書かない（R3）。
      テスト `dspfPreviewHtml.test.ts`（PRTF と同じく生成 HTML への正規表現アサーション。
      ドラッグの受け口と送り口が対になっていることも見る）。
- [x] T9: `language/dspfPreview.ts`（殻）＋ `language/registration.ts` に `registerDspfPreview` 追加
      ＋ `package.json` に `rpgClSupport.showDspfPreview` を追加（依存: T8）。
      - 対象判定は **`resolveDdsType(fsPath) === "DDS-DSPF"`**（独自の `isDspf` を作らない）。
      - viewType `rpgClSupport.dspfPreview`、PRTF とは**別の module-level セッション**。
      - メッセージは `reveal` / `move` の 2 種（PRTF と同形）。拡張→WebView は持たない。
      - **`move` で modal 確認を出さない**（DSPF は常に絶対位置）。書き戻しは `ddsPositionWriteBack`。
      - 再描画は `onDidChangeTextDocument` / `onDidChangeTextEditorSelection` / `onDidCloseTextDocument`。
      - **設定項目は追加しない**。`activationEvents` も変更しない。`contributes.languages` に触らない。
- [x] T10: 配線の到達性テスト `dspfPreviewWiring.test.ts`（依存: T9）。
      vscode stub でコマンドを実際に `handler()` 実行し `panel.webview.html` に中身が入ること。
      `.mnudds` の合成ドキュメントでも開けること（R6）。`.prtf` では何も起きないこと。
      エディタ無しの分岐。

## 第 4 段: 受け入れ

- [x] T11: 実サンプル `docs/src/CUSTMNT.dspf` に対する結合テスト（依存: T7, T8）。
      `'顧客保守'` row=1 col=25 **width=10** occupancy=`[24,35]` /
      `'顧客番号'` row=2 col=5 width=10 /
      `CUSTNO`・`CUSTNM` が `widthUnknownReason:"reference"` /
      `MSGTXT` row=23 col=2 width=50 occupancy=`[1,52]` /
      画面サイズ 24×80（`DSPSIZ(24 80 *DS3)` 由来）/ **診断ゼロ**。
- [x] T12: 全体の退行確認と仕上げ（依存: 全部）。
      `npm test` 全通過（特に PRTF 書き戻しの恒等性＝R7）、`npm run compile` が通る、
      `.length` による桁計算が混入していないことを grep で確認（R3）、
      `docs/src/CHECKLIST.md` に DSPF 画面プレビューの確認手順を追記。
