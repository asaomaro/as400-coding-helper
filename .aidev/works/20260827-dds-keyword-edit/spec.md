# 仕様: キーワード欄の編集

## 設計方針

**折り返しは「切れ目で折る」を第一にする。** キーワードの区切りで次の行へ置けるなら、
継続記号は使わない（`toLogicalUnits` が空白 1 つで連結する）。
`-` を使うのは**1 つのキーワードが 36 桁に収まらないときだけ**。

**往復で固定する。** 書き出した結果を読み直すと元のキーワードの並びに戻ることを、
定義から作った入力で**総当たり**して確かめる。

## 対象範囲

| ファイル | 変更 |
|---|---|
| `src/core/dds/ddsEditWriteBack.ts` | `foldKeywordArea` / `buildKeywordLine` |
| `src/core/dds/ddsEdit.ts` | `setKeywords` / 拒否 2 種 / 継続にまたがる `text` の解禁 |
| `src/dds/webview/protocol.ts` | `parseEdit` が `setKeywords` を通す |
| `src/dds/webview/ui.ts` / `ui.css` | `✕` / `＋` / 生テキストの編集 |

## インターフェース / データ構造

```ts
/** キーワード欄（45-80 桁 ＝ 36 桁）の幅。 */
export const KEYWORD_AREA_WIDTH: number;

/**
 * キーワード欄のテキストを、1 行に収まる塊へ折る。
 * 返り値の 1 つ目が代表行の欄、2 つ目以降が継続行の欄。
 */
export function foldKeywordArea(keywords: string): readonly string[];

/** 継続行（1-44 桁は空白）を組み立てる。 */
export function buildKeywordLine(area: string): string;
```

```ts
| {
    readonly kind: "setKeywords";
    readonly sourceLine: number;
    /** 欄**全体**の新しいテキスト（結合後の形）。 */
    readonly keywords: string;
  }
```

拒否コード（追加）:

| コード | いつ |
|---|---|
| `constant-needs-literal` | 定数の欄がリテラルで始まらなくなる |
| `keyword-lines-not-contiguous` | 項目のキーワード行の間に注記行が挟まっている |

## 振る舞いの詳細

### 折り返し（`foldKeywordArea`）

1. `parseKeywordEntries` で区切りに分ける。
2. 前から詰める。**空白 1 つ**で繋いで 36 桁に収まるうちは同じ塊に入れる。
3. 入らなければ**次の塊**へ送る（＝次の行。継続記号は使わない）。
4. **1 つの区切りだけで 36 桁を超える**なら、そこだけ `-` で切る。
   1 行目は 35 桁ぶん ＋ `-`、次の行に残りを置く（残りがまだ超えるなら繰り返す）。
5. 空なら空配列（欄を空にする）。

| 入力 | 折り返し |
|---|---|
| `DSPATR(RI) COLOR(RED)` | `["DSPATR(RI) COLOR(RED)"]`（22 桁） |
| `DSPATR(RI HI ND) COLOR(RED) CHECK(RZ)` | 切れ目で 2 行 |
| `EDTWRD('` ＋ 40 桁の中身 | `-` で切る |

### `setKeywords` の適用

- 宛先は**代表行から始まる連続区間**。区間は
  `unit.sourceLines` のうち**代表行以降**（＝継続行 ＋ キーワードだけの行）。
- 置き換え後の行 = 代表行の 1-44 桁 ＋ 折り返しの 1 つ目 / 以降は継続行。
- 折り返しが空なら、代表行は**キーワード欄を空にした 1 行**だけになる。

### `setAttributes` の `text`

- 代表行が**継続を始めていない**なら従来どおり（代表行の欄だけを差し替える）。
- **継続を始めている**なら、`replaceLeadingConstant(unit.keywords, text)` で欄全体を作り、
  `setKeywords` と同じ経路で書き出す。これで前の work の `keyword-continuation` は**外れる**。

### 検証

- 定数（`unitItemKind === "constant"`）で、新しい欄が
  `'…'` で始まらない → `constant-needs-literal`。
- 代表行以降の `sourceLines` が連続していない → `keyword-lines-not-contiguous`。
- 行の上限（`MAX_LINE_COLUMNS`）は折り返しで必ず満たす（検証不要）。

### UI

- チップに `✕`（リテラルには付けない）。押すとその区切りを外して `setKeywords`。
- `＋` を押すと入力欄が開く。`<datalist>` に**そのレベルのキーワード名**を出す
  （様式なら `record`、項目なら `field`。`level` を持たないものは常に出す）。
  確定すると `NAME`（引数を取るものは `NAME()`）を末尾に足して `setKeywords`。
- 生テキストは**編集できる**。`Enter` / フォーカスを外して確定、`Esc` で元に戻す。
- キーは**キャンバスへ漏らさない**。

## ドメイン固有の考慮

- **`+` は書き出さない。** 読む側は両方を解釈するが、書くのは `-` だけ
  （`+` は先頭の空白を捨てるので、空白を含む値で再現性が落ちる）。
- **切れ目で折れるならそちらを優先**。`-` だらけの並びは読めない。
- 使用レベルは**候補の並びにだけ**効かせる。**書けるかの検証には使わない。**

## エラー処理 / 異常系

- 折り返しの入力に改行が混ざる → 空白に潰す（入力欄からは来ないが、守っておく）。
- 引用符が閉じていないテキスト → `parseKeywordEntries` が行末までを 1 区切りにするので、
  折り返しは成立する（読み直すと同じ形に戻る）。

## 受け入れ基準との対応

| AC | 満たし方 |
|---|---|
| AC1 | `foldKeywordArea` の 2-3（切れ目で折る） |
| AC2 | チップの `✕` → `setKeywords` |
| AC3 | `＋` と `<datalist>`（原典の表から） |
| AC4 | 往復の総当たりテスト |
| AC5 | `constant-needs-literal` |
| AC6 | 生テキストの編集 → `setKeywords` |
| AC7 | 継続にまたがる `text` を `setKeywords` の経路へ回す |
| AC8 | 実機で折り返した結果をコンパイルし、`Expanded Source` を編集前と比べる |
