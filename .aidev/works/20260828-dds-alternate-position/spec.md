# 仕様: 画面サイズの「位置の上書き行」を配置に反映する

## 設計方針

**上書き行は直前の項目のもの。** 「条件だけの行（次の単位への前置き）」と
**位置の有無**で見分ける——前置きは項目と同じ行に最後の標識を置くので位置を持たない。

**1 項目 2 位置をモデルに持たせない。** 代わりに `resolveDspfLayout` に
「どちらのサイズで解くか」を渡し、**解決を 2 回まわす**。項目の形は変わらないので、
一覧・プロパティ・標識・編集の経路をどれも触らずに済む。

## 対象範囲

- `src/core/dds/ddsLogicalUnits.ts` — `position-override` の分類と `alternatePositions`
- `src/core/dds/dspfLayout.ts` — `DspfLayoutOptions.screenSize` と行の形の検査
- `src/core/dds/dspfRenderModel.ts` — `RenderModel.secondaryScreen`
- `src/cli/dds.ts` — `--screen-size`
- `src/dds/webview/ui.ts` — 切替と、2 次でのドラッグ禁止
- `dev/standalone.ts` — 2 サイズのサンプル

## インターフェース / データ構造

```ts
type DdsLineKind = "record" | "item" | "conditioning" | "position-override" | "keywords" | "none";

interface AlternatePosition { sourceLine: number; line: string; conditioningLines: readonly string[] }
readonly alternatePositions: readonly AlternatePosition[];

interface DspfLayoutOptions { screenSize?: "primary" | "secondary" }
interface SecondaryScreen { canvas; name?; items; diagnostics }
readonly secondaryScreen?: SecondaryScreen;
```

## 振る舞いの詳細

### 条件名が書ける行の形（実機で確定）

| 条件名を書く行 | `CRTDSPF` |
|---|---|
| **位置の上書き行**（条件名 ＋ 位置だけ） | **通る** |
| 定数の行（独立した項目） | 通らない |
| 項目自身の行（名前つき） | 通らない |
| 様式の行 | 通らない |
| キーワード行（`DSPATR` / `COLOR` / `OVERLAY` で確認） | 通らない |

**原典と食い違う**——原典は「キーワードの使用や フィールドの位置を条件付ける」と
書くが、実機はキーワードの条件付けを通さない。AGENTS.md に従い実機を採る。

### 2 次で解く

上書き行のうち**対象のサイズを指すもの**の位置で描く。無ければ項目自身の位置。
2 次が宣言されていなければ 1 次で解く（呼び出し側が知らずに指定しても壊れない）。

### 2 次では動かせない

位置を決めているのは上書き行なので、掴んで動かすと**項目自身の行**
（＝1 次の位置）を書き換えてしまう。選ぶことはできる。理由をステータスに出す。

## 受け入れ基準との対応

- AC1: `classifyDdsLine` の `position-override` と `toLogicalUnits` の付け替え
- AC2: `DspfLayoutOptions` / `secondaryScreen` / `--screen-size` / 切替
- AC3: 上書きが無ければ項目自身の位置
- AC4: 行の形の検査（実機の表）
- AC5: `onPointerDown` の早期 return
