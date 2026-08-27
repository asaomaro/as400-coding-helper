# 仕様: 条件つきの `COLOR` / `DSPATR` を条件として扱う

## 設計方針

**捨てているものを持つ。** `toLogicalUnits` がキーワードだけの行を連結するとき、
その行の条件付けを一緒に覚える。

`unit.keywords`（全部を繋いだもの）は**そのまま残す**。`readConstant` /
`fieldWidth` / `readSpacing` / チップ表示 / `setKeywords` の 5 か所が読んでおり、
ここから条件つき分を引くと**それらの意味が変わる**（条件つき `EDTCDE` で幅が変わる等）。
今回変えるのは**見え方の解決だけ**なので、追加の見方（`keywordGroups`）を足す。

## 対象範囲

- `src/core/dds/ddsLogicalUnits.ts` — `KeywordGroup` と `LogicalUnit.keywordGroups`
- `src/core/dds/dspfLayout.ts` / `prtfLayout.ts` — `PlacedItem` に載せる
- `src/core/dds/ddsRenderItem.ts` — `RenderItem.keywordGroups` と `appearance` の求め方
- `src/core/dds/dspfAttributes.ts` — 条件を見る解決
- `src/core/dds/dspfRenderModel.ts` — `applyIndicators` で見え方を作り直す
- `src/dds/webview/ui.ts` — プロパティに条件つきキーワードを出す

## インターフェース / データ構造

```ts
/** 条件ごとのキーワード欄。 */
export interface KeywordGroup {
  /** その行の条件付け（7-16 桁）。代表行の分は `{ kind: "none" }`。 */
  readonly conditioning: Conditioning;
  /** その行（と継続行）の機能欄。 */
  readonly keywords: string;
  /** 1 始まり。 */
  readonly sourceLine: number;
}
```

`LogicalUnit.keywordGroups[0]` は代表行。**項目自身の条件はここに入れない**——
項目が出るかどうかは `conditioningLines` が決めており、出た時点で自分のキーワードは効く。

`unit.keywords` は `keywordGroups` の連結と**常に一致する**（検査で固定する）。

```ts
/** 成立している条件のキーワードだけで見え方を求める。 */
export function resolveAppearanceUnder(
  groups: readonly KeywordGroup[],
  states: IndicatorStates
): ScreenAppearance;
```

## 振る舞いの詳細

### どのグループを効かせるか

`evaluateConditioning(group.conditioning, states)` が

| 結果 | 効かせるか | 理由 |
|---|---|---|
| `shown` | ○ | 成立している |
| `unknown` | **○** | 未設定は「決まらない」。既定の見え方を変えないため |
| `hidden` | ✕ | 不成立と決まった |

**項目の表示と同じ倒し方**（`applyIndicators` の「消すのは不成立と決まったものだけ」）。
片方だけ別の倒し方にすると、同じ標識で項目は残るのに色だけ消える、が起きる。

### `COLOR` は「有効になっているものの最初」

原典（`COLOR`）:
> 1 つの出力命令について 2 つ以上の COLOR キーワードが**有効になっている**場合には、
> …**DDS で最初に指定されている COLOR キーワード**を使用します

したがって**先に条件で絞り、そのあと最初のものを採る**。順序はソースの順。

### プロパティ

条件つきのキーワードがある項目には、`条件つきキーワード` の行を出す
（`30: DSPATR(RI)` のように、条件とキーワードを並べる）。
**キーワードのチップは今までどおり全部出す**——書いてあるものは全部見えるべきで、
条件は別の行で示す。

## ドメイン固有の考慮

- **WebView 側でも評価される**（AGENTS.md「プロンプターは『モデルまで』では届いていない」）。
  ここは `applyIndicators` が `ui.ts` から呼ばれており、UI は結果を描くだけなので
  評価の写しは生まれない。**写しを作らないこと**を保つ。
- `applyIndicators(model, {})` は引数を**同一参照で**返す（既存の担保）。
  見え方の作り直しもこの中に入れるので、空のときは何もしない。

## エラー処理 / 異常系

- 条件付け欄が読めない（`readConditioning` が `none` を返す）行は無条件として扱う。
  いまと同じ。

## 受け入れ基準との対応

- AC1: `resolveAppearanceUnder` が `hidden` のグループを外す
- AC2: `unknown` を効かせる
- AC3: `ui.ts` のプロパティに `条件つきキーワード`
- AC4: `applyIndicators` の早期 return はそのまま
- AC5: `prtfRenderModel` も `keywordGroups` を渡す（PRTF に `DSPATR` は無いので既定のまま）
