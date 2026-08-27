# 仕様: PRTF をビジュアルエディタで開く

## 設計方針

**翻訳を共有し、解決は種別ごとに持つ。** 描画に要るのは「文字と、それが何桁を占めるか」で、
これは画面か紙かに依らない。配置（どこに置くか）だけが違うので、
`toRenderItem` を種別に依らない形に切り出し、`resolveDspfLayout` / `resolvePrtfLayout` の
どちらの結果からも同じ `RenderModel` を作る。

**帳票に無いものを持ち込まない。** 属性文字も 5250 の配色も表示装置のもの。
切替ボタンごと**出さない**（押しても何も起きないボタンは「壊れている」と読まれる）。

**行送りで決まる行は書き換えない。** 位置欄に行番号を書くと `SPACE`/`SKIP` が無効になる。
桁だけを動かす専用の編集（`moveColumn`）を持ち、UI は**縦のドラッグを起こさない**。

## 対象範囲

| ファイル | 変更 |
|---|---|
| `src/core/dds/ddsRenderItem.ts` | **新規**（種別に依らない翻訳を切り出す） |
| `src/core/dds/dspfRenderModel.ts` | 切り出したものを再輸出 / `kind` を広げる / 診断の型 |
| `src/core/dds/prtfLayout.ts` | `PlacedItem` に翻訳に要る欄を足す（**足すだけ**） |
| `src/core/dds/prtfRenderModel.ts` | **新規** |
| `src/core/dds/ddsEdit.ts` / `ddsPositionWriteBack.ts` | `moveColumn` と `row-from-spacing` |
| `src/dds/webview/protocol.ts` | `moveColumn` を通す |
| `src/dds/webview/ui.ts` / `ui.css` | 種別で出し分け / 横だけのドラッグ / オーバーフロー行 |
| `src/dds/editorProvider.ts` / `package.json` | `.prtf` を対象に足す |
| `dev/standalone.ts` ほか | 帳票の題材 |

## インターフェース / データ構造

```ts
// ddsRenderItem.ts
export interface PlacedSource { /* DSPF / PRTF の配置解決が返す項目の共通形 */ }
export function toRenderItem(item: PlacedSource): RenderItem;

export interface RenderItem {
  // …既存…
  /** 行が行送り（SPACE / SKIP）で決まる（帳票）。 */
  readonly rowFromSpacing?: boolean;
}

// prtfRenderModel.ts
export function buildPrtfRenderModel(
  lines: readonly string[],
  options?: PrtfLayoutOptions
): RenderModel;

// dspfRenderModel.ts
export interface RenderModel {
  readonly kind: "dspf" | "prtf";
  /** オーバーフロー行（帳票のみ）。 */
  readonly overflowLine?: number;
  readonly diagnostics: readonly RenderDiagnostic[]; // 画面と帳票のコードの和
}

// ddsEdit.ts
| { kind: "moveColumn"; sourceLine: number; column: number }
```

拒否コード（追加）: `row-from-spacing`。

## 振る舞いの詳細

### 紙面

`CRTPRTF` の `PAGESIZE` / `OVRFLW` で決まり **DDS には書かれていない**。
VSCode 側は設定（`rpgClSupport.prtf.pageLength` / `pageWidth` / `overflowLine`）から採る
——**帳票プレビューと同じ設定**。単独起動は `CRTPRTF` の既定（66 × 132 / 60）。

### 占有

帳票に属性文字は無いので `{ start: column, end: column + width }`。

### 一覧

`buildDspfOutline` は位置欄しか見ないので、行番号を書かない帳票の項目を
すべて「位置なし」と判定してしまう。**配置できた項目は解決後の行・桁を入れて理由を落とす**
（`placedOutline`）。

### 編集

| 操作 | 行番号を書いた項目 | 書いていない項目 |
|---|---|---|
| ドラッグ | 縦横に動く（`move`） | **横だけ**（`moveColumn`） |
| 矢印キー | 縦横 | 左右だけ |
| `move` が来たら | 通す | **`row-from-spacing` で拒否** |

### 描画

- 属性文字を描かない。`属性バイト` / `5250 配色` の切替を**出さない**。
- オーバーフロー行に破線を引く。
- ツールバーに種別（`帳票` / `画面`）を出す。
- 行が行送りで決まる項目は `cursor: ew-resize`（横にしか動かないことを手応えで示す）。

## 受け入れ基準との対応

| AC | 満たし方 |
|---|---|
| AC1 | `customEditors` に `*.prtf` ＋ `buildPrtfRenderModel` |
| AC2 | `moveColumn`（桁欄の書き戻し） |
| AC3 | `resolvePrtfLayout` の解決結果をそのまま描く |
| AC4 | 種別での出し分け（属性文字・配色） |
| AC5 | `row-from-spacing` の拒否と、UI の横だけドラッグ |
| AC6 | `prtfLayout` の診断をそのまま `RenderModel` に載せる |
| AC7 | DSPF の経路を変えない（既存 671 件が回帰の網） |
