# 仕様: 条件標識の解決と標識パネル

## 概要

条件付け欄（7-16 桁）を**論理式として解決**する関数を core に足し、
**標識の状態は UI が持つ**（ソースを書き換えない表示なので、SO/SI・グリッド・ズームと同じ扱い）。
UI は core の純関数 `applyIndicators(model, states)` を通してから描く。

## 設計方針

### 1. 判断は core、状態は UI

直前の work（`20260826-dds-display-toggles`）で確立した境界を守る——
**表示の状態はホストへ送らない**。標識の状態も同じで、`protocol.ts` は変えない。

ただし「どの標識でどう見えるか」という**規則は core**に置く。UI が持つのは
`{ "01": "on", "30": "off" }` という状態だけで、**評価はしない**。
UI から見た形は「モデルを変換する関数を 1 つ通す」だけになる:

```
render():  const shown = applyIndicators(this.model, this.indicators)
```

これで既存の描画・ツリー・診断のコードは**そのまま**（入力のモデルが差し替わるだけ）。

### 2. 状態が空なら恒等

`applyIndicators(model, {})` は**引数のモデルをそのまま返す**（新しい配列も作らない）。
AC7（既定の描画が変わらない）を、テストではなく**構造で**保証する。

### 3. 3 値と Kleene 論理

未設定の標識を含む条件は「成立」とも「不成立」とも決めない。
**不成立と決まったものだけ**を消す——決まらないものを消すと、
標識を 1 つ設定しただけで無関係な項目が消えることになる。

### 4. 重なりは「状態を明示したときだけ」足す

research F6 のとおり、静的な厳密化はしない。
状態を 1 つ以上設定しているときに限り、**その状態で同時に出ると決まった**項目どうしの
重なりを別のコード（`overlap-under-indicators`）で足す。既存の指摘とは**重複させない**
（既存が出すのは「両方とも無条件」の組だけなので、その組を飛ばす）。

## 対象範囲

| ファイル | 変更 |
|---|---|
| `src/core/dds/ddsConditioning.ts` | 追加のみ（`readConditioning` / `isMutuallyExclusive` は不変） |
| `src/core/dds/dspfRenderModel.ts` | `RenderItem.condition` / `RenderModel.indicators` / `applyIndicators` |
| `src/core/dds/dspfOutline.ts` | `HiddenReason` に `"condition-off"` を追加（型のみ） |
| `src/dds/webview/ui.ts` | 標識カード・条件行・`describeHidden` |
| `src/dds/webview/ui.css` | 標識カードの見た目 |
| `src/dds/webview/protocol.ts` | **変更しない** |
| `src/dds/editorProvider.ts` / `dev/standalone.ts` | **変更しない** |

## インターフェース / データ構造

### core: `ddsConditioning.ts`（追加）

```ts
/** 標識の状態。鍵は必ず 2 桁（"01".."99"）。未設定の標識は**鍵ごと無い**。 */
export type IndicatorStates = Readonly<Record<string, "on" | "off">>;

/** 条件の解決結果。3 値。 */
export type ConditionResult = "shown" | "hidden" | "unknown";

/**
 * 行単位の `clauses` を、原典の言う「条件」（OR で結ばれる AND の組）へ畳む。
 * 1 行目は必ず新しい条件を開始する（原典: 最初の条件の O はブランク扱い）。
 */
export function conditionGroups(c: Conditioning): readonly (readonly IndicatorTerm[])[];

/** 標識の状態から、その項目／キーワードが選択されるかを解決する。 */
export function evaluateConditioning(c: Conditioning, states: IndicatorStates): ConditionResult;

/** 人が読む形。例: `01 かつ N02、または 03`。条件が無ければ空文字。 */
export function describeConditioning(c: Conditioning): string;

/** ソース中に現れる標識。番号順。 */
export interface IndicatorUsage {
  readonly indicator: string;   // "01".."99"
  readonly uses: number;        // その標識が書かれた**桁の数**（行ではない）
}
export function collectIndicators(lines: readonly string[]): readonly IndicatorUsage[];
```

### core: `dspfRenderModel.ts`（追加）

```ts
export interface RenderItem {
  // …既存…
  /** 条件付け。**解決はしない**（状態は UI が持つ）。 */
  readonly condition: Conditioning;
}

export interface RenderModel {
  // …既存…
  /** ソース中で使われている標識（番号順）。パネルの並びになる。 */
  readonly indicators: readonly IndicatorUsage[];
}

/**
 * 標識の状態をモデルに反映する。**純関数**。
 * - `states` が空なら `model` をそのまま返す。
 * - 不成立の項目を `items` から外し、`outline` の同じ項目に `hidden: "condition-off"` を付ける。
 * - 状態があるときだけ、その状態での重なりを `diagnostics` に足す。
 */
export function applyIndicators(model: RenderModel, states: IndicatorStates): RenderModel;
```

### core: `dspfOutline.ts`

```ts
export type HiddenReason =
  | "no-position" | "invalid-position" | "not-displayed"
  | "condition-off";   // 追加。**生成側（buildDspfOutline）は付けない**
```

### UI

- 表示状態に `indicators: IndicatorStates` を足す（`display` とは別のフィールド。
  `display` は真偽値とズームだけの平坦な形なので混ぜない）。
- 左ペインに 2 枚目のカード。

```
┌ レコード様式 ─────┐
│ R HEADER          │   ← 既存（伸縮する）
│  …                │
├ 条件標識 ─────────┤
│ 01  未設定 オン オフ│   ← 追加（最大 40% の高さでスクロール）
│ 30  未設定 オン オフ│
│ [すべて未設定]      │
└───────────────────┘
```

## 振る舞いの詳細

### 条件の畳み込み（`conditionGroups`）

| 入力（行の 7 桁目と標識） | 条件（OR グループ） |
|---|---|
| `  01` | `[[01]]` |
| `  01` / `  02`（2 行目ブランク） | `[[01, 02]]`（AND 継続） |
| `  01` / `A 02` | `[[01, 02]]` |
| `  01` / `O 02` | `[[01], [02]]` |
| `O 01` / `O 02`（1 行目に O） | `[[01], [02]]`（1 行目の O はブランク扱い） |
| 1 行に `01` `N02` `03` | `[[01, N02, 03]]`（同じ行の 3 枠は AND） |

### 評価（`evaluateConditioning`）

- `none` → `"shown"`。`screen-size` → `"shown"`（不一致は `resolveDspfLayout` が既に落としている）。
- 項（term）: 状態が無ければ `unknown`。`negated` なら `off` で真、`on` で偽。その逆も同様。
- 条件（AND）: 1 つでも偽 → 偽。偽が無く未知があれば → 未知。全部真 → 真。
- 全体（OR）: 1 つでも真 → `"shown"`。真が無く未知があれば → `"unknown"`。全部偽 → `"hidden"`。

### 標識の列挙（`collectIndicators`）

- **注記行（7 桁目が `*`）と空行を除く全行**の 7-16 桁を見る（research F3: キーワードだけの行にも
  条件が付くため、論理単位からは集めない）。
- 8 桁目から `*` で始まる行は画面サイズ条件名なので**標識ではない**（数えない）。
- 3 枠（8-10 / 11-13 / 14-16）それぞれで `01`-`99` を拾う。`N` は状態の指定であって
  **別の標識ではない**ので、`N01` も `01` として数える。
- 同じ標識が同じ行の別の枠にあれば 2 と数える（`uses` は「書かれた桁の数」）。
- 番号の昇順で返す。

### 状態の適用（`applyIndicators`）

1. `Object.keys(states).length === 0` なら `model` をそのまま返す。
2. 各 `RenderItem` を評価。`"hidden"` の `sourceLine` を集める。
3. `items` = 集合に入らないもの。
4. `outline` = 各項目について、集合に入っていれば `hidden: "condition-off"` を付ける
   （**既に `hidden` が付いている項目は上書きしない**——構造的な理由のほうが先）。
5. `diagnostics` = 既存 ＋ 状態での重なり。
   - 対象は `evaluateConditioning === "shown"` の項目のみ（`unknown` は出るとは決まっていない）。
   - **両方とも `condition.kind === "none"` の組は飛ばす**（既存の指摘と重複するため）。
   - `row` が同じ・`recordName` が同じ・`widthCols` が両方読める組だけ見る。
   - 判定は占有（属性文字を含む）の重なり。既存 `detectOverlaps` と同じ規則。
   - コード `overlap-under-indicators`、文言は「標識 01=オン, 30=オフ のとき **A** と **B** が
     n 行目で重なります」。

### UI: 標識カード

- `model.indicators` が空 → カードごと出さず、`条件標識: 使われていません` の 1 行だけ出す（AC-I1）。
- 1 標識 = 1 行。左に番号（`01`）、右に 3 択の分割ボタン。
  `role="radiogroup"` / `aria-label="標識 01"`、子は `role="radio"` / `aria-checked`。
  ローミング `tabindex`（選択中だけ `0`、他は `-1`）。
- キー: `ArrowLeft` / `ArrowUp` で前、`ArrowRight` / `ArrowDown` で次、`Home` / `End` で両端。
  選んだ時点で確定（APG の「選択が即座に反映される」形）。**キーは伝播させない**（AC-I5）。
- 番号の右に使用箇所の件数（`3 か所`）。
- `すべて未設定` ボタン。1 つも設定が無いときは `disabled`。
- 再描画でフォーカスを失わないよう、`render()` は**フォーカス中の標識と値**を覚えて戻す（AC-I4）。

### UI: プロパティの条件行

- `条件` 行を読み取り専用で足す。`describeConditioning` が空なら `なし`。
- 状態を設定しているときは、その項目の**現在の解決結果**も併記する
  （`01 かつ N02（いまは 出る）`）。読めば分かるものを読ませないため。

### UI: 様式ツリー

- `describeHidden` に `condition-off` → `条件で非表示` を足すだけ。

## ドメイン固有の考慮

- **7 桁目は注記マークと AND/OR を兼ねる**。列挙で注記行を除かないと `*` を条件として読む。
- **`N` は標識の一部ではない**。状態の鍵は必ず 2 桁に正規化する
  （`readConditioning` が既に `padStart(2,"0")` している）。
- 原典の上限（1 項目あたり 9 条件 × 9 標識）は**検査しない**。読めたものをそのまま扱う——
  上限超えはコンパイラが弾く領域で、エディタが独自に拒むと**既存ソースが開けなくなる**。

## エラー処理 / 異常系

- 条件付け欄に `01` でも `*XXX` でもないゴミ（`ZZ` など）→ `readConditioning` が既に捨てている。
  列挙も同じ規則で捨てる（**同じ判定を 2 か所に書かない**——列挙は `readConditioning` を通す）。
- 標識の状態に `"1"` や `"100"` のような不正な鍵が入っても、評価側は
  **鍵が一致しないだけ**で `unknown` に落ちる（例外にしない）。
- 標識の状態を設定したまま別のファイルを開いた → 状態は**そのまま持ち越す**
  （標識番号はファイルに依らない意味を持たないが、開き直すたびに消えるほうが煩わしい）。
  一覧に無い標識の状態は**表示されないだけ**で害が無い。

## 受け入れ基準との対応

| AC | 満たし方 |
|---|---|
| AC1 | `conditionGroups`（原典どおりの畳み込み）＋ `evaluateConditioning`（Kleene 3 値） |
| AC2 | `collectIndicators`（全行の条件付け欄・番号順・`uses` つき） |
| AC3 | 左ペインの標識カード（3 択ラジオ ＋ `すべて未設定`）。`render()` が即座に反映 |
| AC4 | `applyIndicators` が `items` から外し、`outline` に `condition-off` を付ける |
| AC5 | プロパティの `条件` 行（`describeConditioning` ＋ 現在の解決結果） |
| AC6 | `applyIndicators` の `overlap-under-indicators`（状態が空なら足さない） |
| AC7 | `applyIndicators(model, {})` が**引数をそのまま返す**（構造で保証） |
| AC8 | 状態は UI 内で完結。`protocol.ts` を変えず、`edit` を送らない |
| AC-I1 | 標識が無ければカードを出さず 1 行の説明にする |
| AC-I2 | ラジオは即時反映。`すべて未設定` が取り消し |
| AC-I3 | `radiogroup` ＋ ローミング `tabindex` ＋ 矢印キー（research F7） |
| AC-I4 | `render()` がフォーカス中の標識と値を覚えて戻す |
| AC-I5 | カード上のキーイベントは `stopPropagation`（キャンバスの矢印移動へ漏らさない） |
