# 仕様: 5250 の配色

## 設計方針

**表は原典から生成し、規則だけを書く。** 対応表は
`docs/origin/generate-dds-attributes.mjs` が原典の 2 つの表から作り、
`verify-dds-attributes.mjs` が**その 2 つが食い違っていないこと**まで見る。

**散文の「無視される」規則は実装しない。** 色は `CS`/`HI`/`BL` の 3 ビットそのものなので、
`COLOR` を書けばその 3 ビットは色が決める——原典が散文で並べている
「HI は無視されます」等は、**ビットで表せば自然に出る**。

**食い違ったら実機を採る。** 原典と実機がずれた 1 点（`COLOR` ＋ `RI` ＋ `UL`）は
実機に従い、根拠をコメントに残す。

## 対象範囲

| ファイル | 変更 |
|---|---|
| `docs/origin/generate-dds-attributes.mjs` | **新規**（原典 → JSON） |
| `docs/origin/verify-dds-attributes.mjs` | **新規**（原典の 2 表の一致まで検査） |
| `resources/completion/dds-attributes.json` | 生成物 |
| `src/core/dds/dspfAttributes.ts` | **新規**（キーワード → 見え方） |
| `src/core/dds/dspfRenderModel.ts` | `RenderItem.appearance` |
| `src/dds/webview/ui.ts` / `ui.css` | 配色で描く / 切替 |
| `vscode-extension/package.json` | `verify:defs` に検査を足す |

## インターフェース / データ構造

```ts
export type ScreenColor = "green" | "white" | "red" | "turquoise" | "yellow" | "pink" | "blue";

export interface ScreenAppearance {
  readonly byte: number;          // 実機の表示属性バイト（0x20-0x3F）
  readonly color: ScreenColor;
  readonly reverse: boolean;
  readonly underline: boolean;
  readonly blink: boolean;        // 明滅する色は赤だけ（原典）
  readonly nonDisplay: boolean;
}

export function resolveAppearance(keywords: string): ScreenAppearance;
```

生成物（`dds-attributes.json`）:

```json
{ "bits": { "RI": 1, "HI": 2, "UL": 4, "BL": 8, "CS": 16, "base": 32 },
  "colorBits": { "green": 0, "white": 2, "red": 8, "turquoise": 16, "yellow": 18, "pink": 24, "blue": 26 },
  "colors": [ { "cs": false, "hi": false, "bl": false, "color": "green", "blink": false }, … ],
  "attributes": [ { "byte": 32, "hex": "20", "color": "green", … }, … ] }
```

## 振る舞いの詳細

### ビットの組み立て

1. `COLOR` があれば `colorBits[色]`、無ければ `DSPATR` の `CS`/`HI`/`BL`。
2. `DSPATR` の `RI` / `UL` を足す。
3. `DSPATR(ND)` は `RI|HI|UL` を足す（原典: UL・HI・RI は ND と同じ結果）。
4. **`COLOR` から来た `HI` で `0x_7`（非表示）になる組は、`UL` を落とす**（実機）。

### 見え方の組み立て

- 色と明滅は `CS`/`HI`/`BL` から（原典の色の表）。
- 反転表示は `RI`、下線は `UL`。
- 非表示は `RI|HI|UL` が揃ったとき。**非表示なら他の属性は立てない**（何も出ない）。
- **桁区切り線は持たない**（原典の 2 表で扱いが食い違い、見た目は文字間の細い点。
  原典自身が「行間隔縮小モードにすると消える」と書いている）。

### UI

- ツールバーに `5250 配色`。**既定は入**。
- 色は文字色。反転表示は前景と背景を入れ替える。下線は `text-decoration`。
- **明滅は点滅させない**（目に障る）。上辺の細い線で示す。
- 非表示は**枠だけ残して中身を伏せる**（消すと直すために選べなくなる）。
- 色の値は**利用者の 5250 エミュレータ（ts5250 の既定テーマ）と同じ**にする。
- **桁と位置は変えない。**

## ドメイン固有の考慮

- `PC` / `MDT` / `OID` / `SP` / `PR` は見え方に効かない（原典の表より）。
- 条件つきの `COLOR` / `DSPATR`（`50 COLOR(RED)`）は**条件を見ない**
  （`toLogicalUnits` がキーワード行の条件付け欄を捨てている）。backlog へ。

## 受け入れ基準との対応

| AC | 満たし方 |
|---|---|
| AC1 | `colorBits`（7 色） |
| AC2 | 色の表（`CS`/`HI`/`BL`） |
| AC3 | 非表示の判定と、枠だけ残す描き方 |
| AC4 | 反転表示・下線・明滅の描き分け（桁区切り線は持たない） |
| AC5 | ツールバーの `5250 配色` |
| AC6 | `generate-dds-attributes.mjs` ＋ `verify-dds-attributes.mjs`（`npm run verify`） |
| AC7 | 実機との突き合わせ（全 61 通り） |
