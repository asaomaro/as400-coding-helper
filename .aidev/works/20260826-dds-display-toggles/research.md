# 調査: 表示切替に必要な事実

## 調査の問い

- **Q1**: SO/SI の記号は既存機能と揃えられるか。
- **Q2**: SO/SI の位置は core の情報から出せるか（UI に判定を持たせずに）。
- **Q3**: ズームで桁がずれない作りになっているか。
- **Q4**: 「他様式の淡色表示」に必要な情報（アクティブ様式）は取れるか。
- **Q5**: ズームとホストの衝突（C1 未解決 #5）は避けられるか。

## 判明した事実

- **F1: 既存の SOSI 表示は `{` と `}`。** `src/language/dbcsShiftMarkers.ts:18` / `:25` が
  `contentText: "{"` / `"}"` を装飾として重ねる（色は `editorCodeLens.foreground`）。
  **同じ記号に揃える**——テキストエディタとデザイナで別の記号を出すと、同じソースが別物に見える。

- **F2: SO/SI の位置は core が既に持っている。** `dspfRenderModel.ts:129` `constantSegments` は
  SO/SI を **`{ text: "", cols: 1 }`（空文字の 1 桁）**として区切りに入れている
  （`shift()`）。ただし **SO と SI の区別が付かない**——どちらも空文字。
  `{` と `}` を出し分けるには**区切りに種別を持たせる**必要がある（core 側の小さな追加）。

- **F3: 桁はすべて CSS 変数で決まる。** `ui.css` の `--cell-w` / `--cell-h` を
  ルーラー（`calc(var(--cell-w) * N)`）・行番号（`height: var(--cell-h)`）・
  キャンバス（`width: calc(var(--cell-w) * var(--cols))`）・項目（`left` / `width`）が**すべて参照**する。
  実測値は `ui.ts:154` `measure()` が `--cell-w` / `--cell-h` に入れる。
  → **倍率を掛けた値を同じ変数に入れれば、全部が同じ倍率で動く**（AC5 は構造的に満たせる）。

- **F4: 座標変換も同じ値を使う。** `geometry.ts` は `CellMetrics`（`cellWidth` / `lineHeight`）を
  引数に取り、`ui.ts` が `this.cellWidth` / `this.lineHeight` を渡す。
  **測定値に倍率を掛けて保持すれば、ドラッグの座標もズームに追随する**（AC-I5）。

- **F5: アクティブ様式は選択から導ける。** `RenderItem.recordName`（`dspfRenderModel`）と
  `OutlineRecord.name`（`dspfOutline`）があり、選択（`sourceLine`）から様式名を引ける。
  **新しい状態を持たなくてよい。**

- **F6: 属性バイトの表示は既に実装済み**（`ui.ts` の `attributeMarkers`・`.dds-attr`）。
  **常時表示**なので、切替を足すだけでよい。グリッドは `.dds-canvas` の
  `background-image`（`repeating-linear-gradient`）なので、クラスで消せる。

- **F7: ズームのキーバインドは張っていない。** 現状 `ui.ts` の `onKeyDown` は
  矢印 / `Delete` / `Escape` だけ。**`Ctrl+=` を張らなければ衝突は起きない**
  （C1 未解決 #5 は「自前ズームとホストのズームが同時に効く」問題で、
  **同時に効く原因はキーを取ること**）。ボタンだけで操作すれば回避できる。

## 影響範囲

- **触る**: `core/dds/dspfRenderModel.ts`（区切りに SO/SI の種別）、
  `dds/webview/ui.ts` / `ui.css`（ツールバー・表示切替・ズーム・桁勘定）、
  `test/unit/dspfRenderModel.test.ts`（種別の検査）、`dev/e2e.mjs`（実操作）。
- **触らない**: 編集系（`ddsEdit` / `ddsEditWriteBack`）・`dspfOutline`・`dspfLayout`・
  `editorProvider`・`protocol`（表示は**ホストに送らない**＝UI 内で完結する）。

## 実現性 / リスク

- **実現可能**。表示はすべて UI 内で完結し、ホストとの契約を増やさない。
- **リスク1: SO/SI を「描く」と桁がずれる。** `{` は 1 桁を占めるが、
  **いまも SO/SI のぶんの桁は空けてある**（区切りに空文字 1 桁がある）。
  そこに文字を置くだけなので**ずれない**——ただし「空けてある桁」ではなく
  項目の前後に足すと**全部ずれる**。区切りの中に描くこと。
- **リスク2: ズームで実測値を上書きしてしまう。** `measure()` は実測値を `--cell-w` に入れる。
  倍率を掛けた値を入れると、**次の measure で倍率が二重に掛かる**。
  実測値と表示値を分けて持つ必要がある。
- **リスク3: 再描画で切替が戻る**（AC7）。表示状態は `render()` の外に持つ。
- **リスク4: 淡色表示が読めなくなる**。淡くしすぎると「見えない」のと同じ。

## 実装アンカー

- **A1: 区切りの生成**（`src/core/dds/dspfRenderModel.ts:129` `constantSegments`、
  `:26` `RenderSegment`）— SO/SI の種別を足す場所。
- **A2: セル寸法**（`src/dds/webview/ui.ts:154` `measure()`）— 実測と倍率を分ける場所。
- **A3: 座標変換**（`src/dds/webview/geometry.ts`、`ui.ts` の `cellMetrics()`）。
- **A4: 属性バイト**（`ui.ts` `attributeMarkers`、`ui.css` `.dds-attr`）。
- **A5: グリッド**（`ui.css` `.dds-canvas` の `background-image`）。
- **A6: ツールバー**（`ui.ts` `template()` の `.dds-toolbar`）。
- **A7: 既存 SOSI の記号**（`src/language/dbcsShiftMarkers.ts:18` / `:25`）。
- **A8: 確定デザインのツールバー**（`docs/design/dds-designer/mock-c1-standalone-first.html`）。

## 実装時の注意

- **SO/SI は「空けてある桁」に描く**（リスク1）。区切りを増やしたり項目の幅を変えたりしない。
- **実測値と表示値を分ける**（リスク2）。`measure()` が入れるのは実測値で、
  倍率を掛けた値を CSS 変数に入れる。
- **表示状態は `render()` の外**（リスク3）。
- **ズームにキーを張らない**（F7）。ホストのズームと取り合わない。
- 既存 SOSI と**同じ記号**（F1）。

## spec への申し送り

1. `RenderSegment` に SO/SI の種別を足す（`shift?: "so" | "si"`）。**UI に判定を持たせない**ため。
2. ズームは**倍率の状態 × 実測値**で表示値を作る。倍率は UI が持ち、ホストに送らない。
3. 表示切替は**ホストとの契約を増やさない**（`protocol.ts` は無変更）。
4. 「スナップ」は**作らない**——常にセルに吸着しており、切替の相手が存在しない。
   C1 のツールバーにあるが、**存在しない機能のボタンを置かない**。理由を記録する。
