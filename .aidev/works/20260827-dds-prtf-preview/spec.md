# 仕様: 帳票のプレビューモード（CPI / LPI）

## 設計方針

**セルの大きさだけを差し替える。** ルーラー・行番号・項目の配置・ドラッグの座標変換は
すべて `--cell-w` / `--cell-h`（＝ `cellWidth` / `lineHeight`）を見ている。
**その 2 つを物理値にすれば**、掴んで動かす経路は何も変えずに済む。

**実測と物理を混ぜない。** 升目のときは「フォントの実測 × 倍率」、
プレビューのときは「物理 × 倍率」。混ぜると倍率が二重に掛かる。

**値の集合は原典から生成する。** 手で書かず、`npm run verify` に載せる。

## 対象範囲

| ファイル | 変更 |
|---|---|
| `docs/origin/generate-dds-print-density.mjs` | **新規**（原典 → JSON） |
| `docs/origin/verify-dds-print-density.mjs` | **新規**（形式・本文・`CRTPRTF` の既定の一致） |
| `resources/completion/dds-print-density.json` | 生成物 |
| `src/core/dds/prtfDensity.ts` | **新規**（値の集合・ソースからの読み取り・紙の大きさ） |
| `src/core/dds/prtfRenderModel.ts` / `dspfRenderModel.ts` | `RenderModel.density` |
| `src/dds/webview/ui.ts` / `ui.css` | プレビューの切替・CPI / LPI の選択・用紙の表示 |
| `vscode-extension/package.json` | 検査の登録 |

## インターフェース / データ構造

```ts
export const CPI_VALUES: readonly number[];   // 原典 10 / 15
export const LPI_VALUES: readonly number[];   // 原典 4 / 6 / 8 / 9 / 12
export const DEFAULT_DENSITY: { cpi: 10; lpi: 6 };  // CRTPRTF の既定

export interface PrintDensity {
  readonly cpi: number;
  readonly lpi: number;
  /** ソースに複数の値が書かれていたか。 */
  readonly mixed: boolean;
  readonly written: { readonly cpi: readonly number[]; readonly lpi: readonly number[] };
}

export function resolvePrintDensity(lines: readonly string[]): PrintDensity;
export function paperInches(page, density): { width: number; height: number };
```

`RenderModel.density?: PrintDensity`（帳票のみ）。

## 振る舞いの詳細

### セルの大きさ

**1 インチ = 96 px**（CSS の絶対単位の定義）。

```
プレビュー:  --cell-w = 96 / CPI × 倍率     --cell-h = 96 / LPI × 倍率
升目:        --cell-w = 実測幅 × 倍率        --cell-h = 実測高 × 倍率
```

10 CPI / 6 LPI なら 9.6 × 16 px（升目の 6.5 × 13 px より縦長）。

フォントは**幅で合わせる**（`--font-scale = セル幅 ÷ 実測幅`）。等幅なので幅が合えば桁が合う。

### 紙の大きさ

**幅（インチ）＝ 桁数 ÷ CPI、高さ（インチ）＝ 行数 ÷ LPI**。
原典の例（66 行 ÷ 6 LPI ＝ 11.0 インチ）で検算する。

### ソースからの読み取り

- `CPI` / `LPI` の値を**上から集め、最初のものを使う**
  （レコード様式は上から処理され、指定が無ければファイル・レベル＝`CRTPRTF` の値に戻る）。
- **原典に無い値は採らない**（コンパイラが弾く。描く側が真似する必要は無い）。
- 複数あれば `mixed`。UI は**そう知らせる**（黙って 1 つで描かない）。

### UI

- ツールバーに `プレビュー`。**既定は切**。**帳票だけに出す**（画面に CPI / LPI は無い）。
- プレビュー中だけ CPI / LPI の `<select>` と用紙の大きさを出す。
- 値は原典の集合。既定はモデルの値（＝ソース、無ければ `CRTPRTF` の既定）。
- **倍率と掛け合わさる**。
- **ソースは変わらない。**

## 受け入れ基準との対応

| AC | 満たし方 |
|---|---|
| AC1 | `--cell-w` / `--cell-h` を物理値にする |
| AC2 | 切替で実測に戻る |
| AC3 | `<select>` の `change` で再描画 |
| AC4 | `paperInches`（原典の式） |
| AC5 | `resolvePrintDensity` がモデルに載る |
| AC6 | `mixed` のときに注記を出す |
| AC7 | 座標変換は `cellWidth` / `lineHeight` を見ているので何も変えない |
| AC8 | `generate-` ＋ `verify-`（`npm run verify` の 16 項目目） |
| AC9 | `isDisplayFile()` で切替を `hidden` |
