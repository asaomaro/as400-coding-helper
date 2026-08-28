# 仕様: ファイル・レベルのキーワードをデザイナから読めるようにする

## 設計方針

**`toLogicalUnits` の返す形は変えない。** `resolveDspfLayout` などの読み手は
「単位＝置けるもの」を前提にしている。ファイル・レベルの行を混ぜると置こうとしてしまう。

**捨てているものを別の口から読む**——`fileLevelKeywordLines(lines)` を足す。

**分類の規則は 1 か所に持つ。** `toLogicalUnits` と新しい読み手で行の見分け方が
食い違うと、同じ行が片方では様式・片方ではキーワードになる。
`classifyDdsLine` に切り出して両方から使う。

## 対象範囲

- `src/core/dds/ddsLogicalUnits.ts` — `classifyDdsLine` / `fileLevelKeywordLines`
- `src/core/dds/dspfRenderModel.ts` — `RenderModel.fileKeywords` / `toFileKeywords`
- `src/core/dds/prtfRenderModel.ts` — 帳票にも載せる
- `src/dds/webview/ui.ts` / `ui.css` — 一覧とプロパティ
- `src/cli/dds.ts` — `parse` の出力

## インターフェース / データ構造

```ts
export type DdsLineKind = "record" | "item" | "conditioning" | "keywords" | "none";
export function classifyDdsLine(line: string, keywords: string): DdsLineKind;

export interface FileKeywordLine {
  readonly sourceLine: number;
  readonly keywords: string;
  readonly conditioningLines: readonly string[];
}
export function fileLevelKeywordLines(lines: readonly string[]): FileKeywordLine[];

// モデル側は条件を解いた形
readonly fileKeywords: readonly FileKeywordEntry[];  // { sourceLine, keywords, condition }
```

## 振る舞いの詳細

### どこまでがファイル・レベルか

**最初の様式または項目まで。** 様式が出たらそこから先は様式のもの。
項目が先に出るソース（本来は不正）でも同じく止まる。注記行・空行は飛ばす。

### 一覧

先頭に「ファイル」の見出しを置き、その下に 1 行 1 件で並べる。
ソースの並びと同じ順（最初の様式より前なので）。

**`record` / `item` のクラスを付けない。** 付けると項目を選ぶ側
（一覧の走査・キー移動・様式の選択）が拾ってしまう。**これらは項目でも様式でもない。**

### プロパティ

チップに分けて原典の解説を引けるようにする（様式・項目と同じ `keywordSection`）。
ただし**読み取り専用**——`✕` / `＋` / 生テキストの編集を出さない。

## ドメイン固有の考慮

AGENTS.md「追加したリソースは到達可能になって初めて完了」。
読めるようにするだけでなく、**一覧から選べてプロパティに出る**ところまでが完了。

## エラー処理 / 異常系

ファイル・レベルのキーワードが無ければ見出しごと出さない。

## 受け入れ基準との対応

- AC1/AC2: 一覧の「ファイル」ノードと `renderFileKeywordProperties`
- AC3: `keywordSection` の `readOnly`
- AC4: `parse` の `fileKeywords`
- AC5: `fileLevelKeywordLines` が `record` / `item` で break
- AC6: `file-keyword` / `file-level` の独自クラス
