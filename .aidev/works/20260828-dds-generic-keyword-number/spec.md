# 仕様: 総称のキーワードに番号を入れさせる

## 設計方針

`＋` の確定で、**総称そのものが打たれていたら送らない**。番号の場所より前だけを
入力欄に残し、使える番号の範囲を案内する。

判定は**表の名前**で行う（打たれた綴りではない）。`cfnn` と小文字で打たれても
総称であることに変わりはなく、`CF03` は総称ではない。

範囲は**原典の説明文から**取り出す。書き写すと原典が変わったときに食い違う。

## 対象範囲

- `src/core/dds/ddsKeywords.ts` — `genericKeywordPrefix` / `genericKeywordRange`
- `src/dds/webview/ui.ts` — `addKeywordButton` の確定

## インターフェース / データ構造

```ts
/** 総称の名前（`CFnn`）なら番号の場所より前（`CF`）。そうでなければ undefined。 */
export function genericKeywordPrefix(name: string): string | undefined;

/** 使える番号の範囲。原典の説明文から取る。無ければ undefined。 */
export function genericKeywordRange(
  help: DdsKeywordHelp
): { readonly from: string; readonly to: string } | undefined;
```

## 振る舞いの詳細

- `genericKeywordPrefix` は「大文字の名前の末尾に小文字が残っている」で見る。
  いまの原典では `nn` の 2 件だけだが、別の綴りが来ても効く。
- `genericKeywordRange` は日英の区切りを両方読む（`-` / `–` / `〜` / `～` /
  `through` / `から`）。
- 番号そのものは**検査しない**。候補は入力の助けであって検証ではない
  （既存の方針。生テキストからは何でも書ける）。

## 受け入れ基準との対応

- AC1: 総称が打たれたら `return`（送らない）。
- AC2: `input.value = prefix`。
- AC3: `genericKeywordRange` の値を案内に入れる。
- AC4: `CF03` は総称ではないので今までどおり通る。
- AC5: `genericKeywordPrefix` が undefined を返すので分岐に入らない。
- AC-I1: `input.hidden` に触らない（開いたまま）。
- AC-I2: `setStatus` に範囲を添える。
- AC-I3: `Esc` の経路は変えていない。
