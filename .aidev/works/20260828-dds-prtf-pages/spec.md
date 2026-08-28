# 仕様: 複数ページの帳票

## 設計方針

### 1. カーソルは**位置（インチ）も持つ**

原典が「行番号ではなく**位置**に基づいて」と言うので、そのとおりにする。

```ts
interface Cursor {
  row: number;      // ページ内の行番号
  page: number;     // 何ページ目か
  inches: number;   // ページ先頭からの位置
  lpi: number;      // いま効いている LPI
  fileLpi: number;  // ファイル・レベル（レコードの終わりで戻る先）
}
```

- **スキップ先の位置** ＝ `行番号 ÷ そのときの LPI`（原典: 48/6 = 8 インチ）。
- **後戻り**（目標 < 現在）なら `page += 1`。
- **行送り** ＝ `行数 ÷ そのときの LPI` だけ進む。
- 処理の順序は原典どおり **LPI → SKIPB → SPACEB → SPACEA → SKIPA**。

LPI が 1 つなら位置は行番号に比例するので、いままでと同じ答えになる（回帰しない）。

### 2. モデルは**全ページ分を持ち、絞るのは描くとき**

`selectPrintPage(model, page)` が 1 ページ分に絞る。
ページを替えるたびにホストへ作り直しを頼むと、**往復のあいだ絵が消える**。
2 次画面サイズ（`screenModel`）と同じ形。

### 3. ページ送りは**密度と同じ帯**に置く

どちらも紙の話なので、帳票の情報を 1 か所にまとめる。
密度が出ない（升目のまま）ときでも、ページが複数なら帯を出す。

## 対象範囲

- `src/core/dds/prtfLayout.ts` — `Cursor` / `skipTo` / `advance` / `readLpi`
- `src/core/dds/prtfRenderModel.ts` — `selectPrintPage`
- `src/core/dds/ddsRenderItem.ts` / `dspfRenderModel.ts` — `page` / `pages` / `currentPage`
- `src/dds/webview/ui.ts` / `ui.css` — ページ送り
- `src/cli/dds.ts` — `--page`

## 振る舞いの詳細

| 操作 | 位置 | ページ |
|---|---|---|
| `SKIPB(n)` / `SKIPA(n)` | `n ÷ lpi` | 目標が現在より**前**なら +1 |
| `SPACEB(n)` / `SPACEA(n)` | `+ n ÷ lpi` | 変わらない |
| `LPI(n)`（様式） | — | — |
| 様式の終わり | — | LPI がファイル・レベルへ戻る |

- 行番号を書いた項目の位置は `行番号 ÷ そのときの LPI`。
- 範囲の外のページを指したら**端に丸める**（空の絵より端のページ）。

## 受け入れ基準との対応

- AC1 / AC2: `skipTo` の改ページと `PlacedItem.page`。
- AC3: `selectPrintPage` ＋ UI のページ送り ＋ CLI の `--page`。
- AC4 / AC5: `advance` / `readLpi` / レコードごとの入れ直し。原典の例を単体で固定。
- AC6: LPI が 1 つなら位置 ∝ 行番号。既存テストが通ること。
- AC-I1 / AC-I2: ページ送りのボタンと「1 / 2」。
