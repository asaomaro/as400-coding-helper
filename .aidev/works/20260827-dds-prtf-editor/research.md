# 調査: PRTF をビジュアルエディタで開く

## 調査の問い

- Q1: PRTF の配置解決はどこまでできているか。作り直しが要るか。
- Q2: 紙面の大きさはどこから採るか（DDS に書かれているか）。
- Q3: 実務の PRTF は位置欄をどう書くか。編集の対象は何になるか。
- Q4: DSPF 用の描画モデルをどこまで流用できるか。
- Q5: 帳票に**無い**概念は何か（持ち込んではいけないもの）。

## 判明した事実

### F1: 配置解決は既にある（`resolvePrtfLayout`）

`src/core/dds/prtfLayout.ts` が **`SPACEA`/`SPACEB`/`SKIPA`/`SKIPB` を解いて絶対の行**を出し、
`PlacedItem`（行・桁・幅・様式名・`sourceLine`・`hasExplicitRow`）と診断を返す。
診断は 7 種（`spacing-with-line-number` / `possible-overprint` / `overlap` / `overflow` ほか）。

**作り直しは要らない。** 帳票プレビュー（`prtfPreview.ts`）と lint（`layout.ts`）が既に使っている。

### F2: 紙面の大きさは **DDS に書かれていない**（Q2 の答え）

ページの行数・桁数は `CRTPRTF` の `PAGESIZE` パラメータで決まる。DDS ソースには無い。
本 PJ は**設定**で持っている（帳票プレビューと同じ）:

| 設定 | 既定 | 出所 |
|---|---|---|
| `rpgClSupport.prtf.pageLength` | 66 | `CRTPRTF` の既定 |
| `rpgClSupport.prtf.pageWidth` | 132 | 同上 |
| `rpgClSupport.prtf.overflowLine` | 60 | `CRTPRTF` の `OVRFLW` 既定 |

→ **エディタも同じ設定を使う**（プレビューと食い違わせない）。単独起動は既定値。

### F3: **実務の PRTF は行番号を書かない**（Q3 の答え・要点）

リポジトリのサンプル `docs/src/CUSTRPT.prtf` の位置欄:

| 行 | 行番号（39-41） | 桁（42-44） |
|---|---|---|
| 5 | **空** | 30 |
| 7 | **空** | 5 |
| 8 | **空** | 15 |
| 9 | **空** | 50 |

原典（`位置 (39 から 44 桁目)`。`prtfLayout.ts` の冒頭に引用がある）:
> 行番号を使用しない場合には、印刷装置ファイル内で必要なフィールド順序のとおりに、
> DDS でフィールドを指定しなければなりません。

**行は `SPACE`/`SKIP` で決まり、桁だけが位置欄に書かれる**のが普通の書き方。
しかも行番号を書くと `SPACE`/`SKIP` は**無効になる**（`prtfLayout` が
`spacing-with-line-number` として診断している）。

→ **編集の対象は「桁」**。行を変える操作は、位置欄ではなく `SPACEA`/`SKIPB` を直す話になる。
この work では**行を変える移動を拒否**し、桁だけを動かせるようにする。

### F4: 描画モデルはほぼ流用できる（Q4 の答え）

`dspfRenderModel.ts` の `fromLayout` は `DspfPlacedItem` → `RenderItem` の翻訳で、
やっていることは**区切り（`segments`）を作る**ことだけ。`constantSegments` / `printWidth` は
種別に依存しない。

`PlacedItem`（PRTF）に足りないのは `usage` / `dataType` / `decimals` / `keywords` /
`conditioning` / `occupancy` で、**どれも `toLogicalUnits` から取れる**
（`resolvePrtfLayout` が既に単位を回している）。

`RenderModel.kind` は `"dspf"` の**リテラル型**だが、UI はまだ分岐に使っていない
（`grep` で確認）。ここに `"prtf"` を足すのが素直。

### F5: 帳票に無い概念（Q5 の答え）

- **属性文字**（項目の前後 1 桁）は**表示装置のもの**。`dspfLayout` の `occupancy` は
  `column - 1` から始まるが、**帳票にこれは無い**（印刷に属性バイトは出ない）。
  → PRTF の占有は**項目そのもの**（`column` から `column + width`）。
- **5250 の配色**（`COLOR` / `DSPATR`）は画面ファイルのキーワード。
  帳票の強調は `HIGHLIGHT` / `UNDERLINE` で別物。→ **PRTF では配色を出さない**。
- `DSPATR` は PRTF のキーワード一覧（65 件）に**無い**（確認済み）。

## 影響範囲

- `src/core/dds/ddsRenderItem.ts`（新規）— 種別に依らない翻訳を切り出す
- `src/core/dds/dspfRenderModel.ts` — 切り出したものを再輸出（既存の import を壊さない）
- `src/core/dds/prtfLayout.ts` — `PlacedItem` に翻訳に要る欄を足す
- `src/core/dds/prtfRenderModel.ts`（新規）
- `src/core/dds/ddsEdit.ts` — 行送りで決まる行の移動を拒否
- `src/dds/editorProvider.ts` / `package.json` — `.prtf` を対象に足す
- `src/dds/webview/ui.ts` — 種別で出し分け（属性バイト・配色）
- `dev/standalone.ts` — PRTF の題材

## 実現性 / リスク

- **リスク: `RenderModel.kind` の型を広げる**。`protocol.ts` と `ui.ts` が
  `RenderModel` を型で受けているだけなので影響は小さいが、**UI の分岐漏れ**に注意
  （属性バイトの切替が PRTF で押せると、押しても何も起きないボタンになる）。
- **リスク: `PlacedItem` の拡張**。プレビューと lint が同じ型を使うので、
  **足すだけ**にする（既存の欄を変えない）。
- **リスク: 行の移動**。実務の PRTF はほぼ全項目が行番号を持たないので、
  **拒否ばかりだと使えない**。桁だけの移動は通す必要がある。

## 実装アンカー

- A1: 翻訳の切り出し元（`src/core/dds/dspfRenderModel.ts:107` `toRenderItem` /
  `constantSegments` / `segmentsWidth`）
- A2: PRTF の配置解決（`src/core/dds/prtfLayout.ts:181` `resolvePrtfLayout` /
  `:33` `PlacedItem` / `:73` `PrtfPage`）
- A3: エディタの登録（`vscode-extension/package.json` の `contributes.customEditors`）と
  モデルの組み立て（`src/dds/editorProvider.ts:262` 付近）
- A4: 種別の判定（`src/core/sourceKind.ts:30` `resolveDdsType`）
- A5: 設定の読み方の先例（`src/language/prtfPreview.ts:42`）
- A6: 移動の書き戻し（`src/core/dds/ddsPositionWriteBack.ts` / `ddsEdit.ts` の `move`）

## 実装時の注意

- **診断を作り直さない**。`prtfLayout` が既に出しているものをそのまま `RenderModel` に載せる。
- **属性文字を PRTF に持ち込まない**（占有は項目そのもの）。
- **配色の切替を PRTF で出さない**（押しても何も起きないボタンは「壊れている」と読まれる）。
- 紙面の大きさは**プレビューと同じ設定**から採る（食い違わせない）。

## spec への申し送り

- 行が行送りで決まる項目は、**桁だけ動かせる**（行を変える移動は拒否）。
- `RenderItem` に「行が行送りで決まるか」を載せ、UI は**縦のドラッグを止める**。
- CPI / LPI は**次の work**（この work は桁と行のモデルまで）。
