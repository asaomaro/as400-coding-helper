# 仕様: 帳票の強調

## 設計方針

### 1. 帳票の見え方は**別の型**にする

```ts
export interface PrintAppearance {
  readonly bold: boolean;       // HIGHLIGHT
  readonly underline: boolean;  // UNDERLINE
  readonly color: string;       // COLOR のカラー名（既定 BLK）
  readonly deviceColor: boolean;// *RGB 等（色は決めない）
}
```

画面の `ScreenAppearance` と混ぜない——**反転表示も明滅も非表示も無く**、
カラー名の集合も違う。1 つの型にすると「帳票の反転表示とは何か」を
考え続けることになる。

### 2. 表は**原典から生成する**

`docs/origin/generate-dds-print-appearance.mjs` →
`resources/completion/dds-print-appearance.json`。`prtfDensity` と同じ形で
core が直接読む（ホストを介さない）。

### 3. 検査は**実機の判定も錨にする**

カラー名の表は画面にも同じ形であり、**原典の中だけでは帳票のものか分からない**。
`verify-dds-print-appearance.mjs` が実機で確かめた 8 件と突き合わせる
（`BLK`/`BRN` があること・`WHT` が無いこと・レベルの違い）。

### 4. `toRenderItem` は**種別で分ける**

```ts
toRenderItem(item, { print: true, recordKeywords })
```

既定は画面（既存の呼び出しは変わらない）。帳票では `printAppearance` を入れ、
画面用の `appearance` は既定のままにする——画面の表を帳票に当てない。

## 対象範囲

`research.md` の「影響範囲」のとおり。

## 振る舞いの詳細

| キーワード | レベル | 効き方 |
|---|---|---|
| `HIGHLIGHT` | 様式・項目 | **様式に書くと中の全項目に効く**（OR） |
| `UNDERLINE` | 項目 | その項目だけ |
| `COLOR(名前)` | 項目 | その項目だけ。**最初の COLOR が効く** |
| `COLOR(*RGB …)` 等 | 項目 | **色を決めない**。指定があることだけ |

- 既定のカラーは `BLK`（原典）。
- 画面のキーワード（`DSPATR`）は読まない。

## 受け入れ基準との対応

- AC1: `resolvePrintAppearance(keywords, recordKeywords)` の OR。
- AC2 / AC3: 同関数。名前は生成した資源から。
- AC4: `deviceColor` を立て、`color` は既定のまま。
- AC5: `options.print` のとき `appearance` は `DEFAULT_APPEARANCE`。
- AC6: 既定引数なので画面側の呼び出しは不変。
- AC-I1: 「見え方」の切替を帳票でも出す。
- AC-I2: `describePrintAppearance`。
