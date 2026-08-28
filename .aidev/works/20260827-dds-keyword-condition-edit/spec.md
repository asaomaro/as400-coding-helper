# 仕様: キーワード行の条件を編集する

## 設計方針

**書き戻しは項目のときと同じ形。** 原典より条件は「最後の (または唯一の) 標識と
同じ行」に置くので、キーワード行を「条件を担う行」とみなせば `writeBackCondition`
がそのまま使える。**新しい桁の規則を書かない。**

宛先だけが違う（項目の代表行ではなくキーワードの行）ので、
**別の編集の種類**にする——同じ `setCondition` で行番号の意味を変えると、
どちらを指しているのか呼ぶ側にも読む側にも分からなくなる。

## 対象範囲

- `src/core/dds/ddsLogicalUnits.ts` — 群に**置き換え範囲**（`sourceLines`）を持たせる
- `src/core/dds/ddsConditioning.ts` — 解決済みの群にも同じものを載せる
- `src/core/dds/ddsEdit.ts` — `setKeywordCondition` と検証・適用
- `src/dds/webview/protocol.ts` — メッセージの型検査
- `src/dds/webview/ui.ts` / `ui.css` — プロパティの「キーワード行」欄

## インターフェース / データ構造

```ts
| { kind: "setKeywordCondition"; sourceLine: number; condition: ConditionGroups }
```

`sourceLine` は**キーワードが書かれている行**（`KeywordGroup.sourceLine`）。

```ts
interface RawKeywordGroup {
  conditioningLines: readonly string[];
  keywords: string;
  sourceLine: number;
  /** 置き換える範囲（先行する条件行 → キーワードの行）。**継続行は含めない**。 */
  sourceLines: readonly number[];
}
```

新しい拒否コード `keyword-line-not-found`（宛先にキーワード行が無い）。

## 振る舞いの詳細

### 宛先

`keywordGroups` の**先頭は代表行**（項目自身の条件で決まる）。宛先にしない
——代表行を指したら `keyword-line-not-found` で断る。`条件` 欄がそちらを担う。

### 置き換え範囲

先行する条件だけの行 → キーワードの行。**継続行（`-` / `+`）は含めない**
（あちらはキーワードの続きで、条件の書き換えでは触らない）。
注記行が挟まっていたら断る（`condition-lines-not-contiguous`）。

### 項目の行は動かない

キーワード行は代表行より**後ろ**にあるので、OR で行が増えても
項目の行番号は変わらない。したがって選択の付け替え（`pendingSelection`）は要らない。

### プロパティ

「キーワード行」の欄に、**代表行以外の群を全部**並べる（条件の有無によらない）。
各行は「キーワード（読み取り）＋条件の入力欄（短い形）」。
条件が無い行にも入力欄を出すので、**そこから条件を足せる**。

いまの標識で効かない行は**薄く見せる**（消さない——書いてあることは見えるべき）。

## ドメイン固有の考慮

- `COLOR` / `DSPATR` が条件付けできることは**実機で確認済み**
  （`20260827-dds-conditional-edtcde`。`EDTCDE` / `EDTWRD` / `CHECK` は通らない）。
  この機能は実在する形のためのもの。
- 短い形（AND は空白 / OR はカンマ）は項目の条件と**同じ**ものを使う。
  2 つ目の記法を作らない。

## エラー処理 / 異常系

- 短い形が読めなければ**送らない**（ステータスに理由、入力欄は元に戻す）。
- 断られたらソースは 1 バイトも変わらない。

## 受け入れ基準との対応

- AC1: `setKeywordCondition` ＋ `writeBackCondition`
- AC2: 置き換え範囲を群の `sourceLines` に限る
- AC3: `keywordGroups.slice(1)` を全部並べる
- AC4: `keywordGroupAt` が代表行を返さない → `keyword-line-not-found`
- AC5: `validateConditionShape` を項目と共有
- AC6: `applyIndicators` が見え方を解き直す（前 work の仕掛けにそのまま乗る）
