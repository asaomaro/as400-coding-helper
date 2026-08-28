# 仕様: 2 次画面サイズでの編集

## 概要

`move` の**宛先**を「項目の行」か「位置の上書き行」かで切り替えられるようにする。
上書き行が無ければ作り、要らなくなったら消せるようにする。

## 設計方針

### 1. `move` に `screenSize` を足す（新しい編集の種類を作らない）

```ts
| { kind: "move"; sourceLine; row; column; screenSize?: "primary" | "secondary" }
```

- 省略時は `"primary"` ＝ **いままでと同じ**（既存の呼び出しは 1 つも変わらない）。
- `DspfLayoutOptions.screenSize`（`dspfLayout.ts:279`）と**同じ語・同じ値**にする。
  絵を解く側と編集する側で言葉が違うと、UI が変換を持つことになる。
- 代替案（`moveAlternate` を新設）を退けた理由: 動かすことは 1 つの概念で、
  違うのは**どの行に書くか**だけ。種類を分けると `validatePosition` /
  `validateColumnOne` / 位置の書き戻しを 2 通り持つことになる。

### 2. 上書き行を消す `clearAlternatePosition` は**別の種類**にする

```ts
| { kind: "clearAlternatePosition"; sourceLine }
```

`remove` に `screenSize` を足す形は採らない。**`remove` は「項目を消す」**で、
同じ語が 2 次では「上書き行だけ消す」に化けると、押した人の予想と食い違う。

これを入れるのは**片道の扉を作らないため**。掴んで上書き行を作れるのに消せないと、
戻すのにテキストエディタが要る（要件の背景そのもの）。

### 3. 実機の規則（`research.md` F1-F5）を検証と生成に落とす

| 規則 | 出所 | 落とす先 |
|---|---|---|
| 挿入は**項目の run の直後** | F1 (P1/P2/P3/P4/P5/PB) | `applyDdsEdits` の挿入位置 |
| 1 項目 **1 本** | F2 (P9) | 既存があれば置換、無ければ挿入 |
| 条件付け欄は**画面サイズ条件名だけ** | F3 (Q3/Q7) | `formatScreenSizeArea` のみで作る |
| 項目に条件が付いていても**よい** | F4 (Q2/Q4/Q5) | 拒否しない |
| **長さ欄を持てない** | F5 (PA) | 空の A 仕様書行から作る／`resize` は 2 次を受けない |

## 対象範囲

- `src/core/dds/ddsEdit.ts` — 型・検証・適用。
- `src/core/dds/ddsLogicalUnits.ts` — run の末尾を出す `unitRunEnd`。
- `src/core/dds/dspfScreenSize.ts` — 2 次に書く条件名を出す `conditionNameFor`。
- `src/dds/webview/ui.ts` / `protocol.ts` — 掴めるようにする・`screenSize` を載せる。
- `src/cli/dds.ts` — `patch` の編集 JSON がそのまま通る（型が広がるだけ）。

## インターフェース / データ構造

```ts
// ddsLogicalUnits.ts
/** その単位が占める最後の行（1 始まり）。上書き行を挿す位置の直前。 */
export function unitRunEnd(unit: LogicalUnit): number;

// dspfScreenSize.ts
/**
 * その大きさを条件付けるときに**書く名前**。
 * ユーザー定義名があればそれ、無ければ IBM 提供名（`*DS3` / `*DS4`）。
 * どちらも決まらなければ undefined（宣言されていないサイズ）。
 */
export function conditionNameFor(entry: ScreenSizeEntry): string | undefined;
```

新しい拒否コード:

| コード | いつ |
|---|---|
| `screen-size-not-declared` | `screenSize: "secondary"` なのに `DSPSIZ` に 2 次が無い |
| `screen-size-not-editable` | PRTF に `screenSize: "secondary"` を渡した |
| `alternate-position-not-found` | `clearAlternatePosition` の宛先に上書き行が無い |

## 振る舞いの詳細

### `move` + `screenSize: "secondary"`

1. `itemUnitAt` で項目を引く（無ければ既存の `line-not-found`）。
2. `alternatePositions` から、2 次のサイズに一致するものを `matchesScreenSize` で探す。
   **`dspfLayout.ts:340` と同じ突き合わせを共有する**（写さない）。
3. **見つかれば**その行の位置欄だけを書き換える（`writeBackPosition`）。
4. **無ければ** `unitRunEnd(unit)` の次に 1 行挿入する。作る行は
   `formatScreenSizeArea(conditionNameFor(sizes.secondary))` ＋ 位置欄だけ。
   6 桁目は `A`。名前・長さ・データ型・用途・キーワードは**書かない**（F5）。

### `clearAlternatePosition`

一致する上書き行を 1 行削除する。無ければ `alternate-position-not-found`。

### 2 次の絵での UI

| 操作 | 振る舞い |
|---|---|
| 掴んで動かす | `move` に `screenSize: "secondary"` を載せて送る |
| 矢印キー | 同上 |
| `Delete` | `clearAlternatePosition`。上書き行が無ければステータスに理由を出す |
| 端を掴む（resize） | 掴ませない。理由をステータスに出す（長さはサイズで変わらない） |

`rowFromSpacing`（帳票の行送り）は表示装置に無いので 2 次では考えない。

## ドメイン固有の考慮

- **9 桁目から書く**。`formatScreenSizeArea` は既にそうなっている
  （`20260828-dds-screen-size-column` の回帰）。ここで桁を作り直さない。
- **`resize` は 2 次を受けない**。長さ欄を持てない（F5）ので、受けても書く場所が無い。

## エラー処理 / 異常系

- 拒否は「ソースに書けないもの」だけ（`ddsEdit.ts:145`）。画面のはみ出しは
  いままでどおり診断で出す。
- 入力が壊れていて上書き行が 2 本ある場合は**先頭を使う**（`find`）。
  実機が通さない形なので、直す責任は書いた人にある。

## 受け入れ基準との対応

- AC1: 手順 3（既存の上書き行の位置欄だけを書き換える）。
- AC2: 手順 4（`unitRunEnd` の次に挿入・`conditionNameFor` で名前を決める）。
- AC3: 手順 4（空の A 仕様書行から作るので他の欄は空のまま）。
- AC4: `screen-size-not-declared`。
- AC5: `screen-size-not-editable`。
- AC-I1/I2/I3: 上表の UI。1 次の経路は `screenSize` を載せないので不変。
