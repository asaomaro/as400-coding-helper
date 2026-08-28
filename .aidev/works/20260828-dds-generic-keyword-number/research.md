# 調査: 総称のキーワードに番号を入れさせる

## 調査の問い

- Q1: 総称の名前を持つキーワードはどれか。
- Q2: 実機は何を通し、何を通さないか。
- Q3: 使える番号の範囲はどこから取れるか（書き写さずに済むか）。
- Q4: `＋` はいま何を書き出しているか。

## 判明した事実

### F1(Q1): 総称は **`CAnn` / `CFnn` の 2 件だけ**

`resources/completion/dds-keywords.json` で名前に小文字を含むものを数えた:
DSPF に `CAnn` / `CFnn`、PRTF・PF には無い。**ファイル・レベルと様式レベルの
両方**の候補に出る（`level: ["file","record"]`）ので、どちらからでも踏める。

### F2(Q2): 実機の判定（IBM i 7.3 / `CRTDSPF`）

`verify/probe-generic-keyword.mjs` が再現する。

| 書いた形 | 実機 |
|---|---|
| `CF03` | 通る |
| `CF03()` | 通る |
| `CF03(03)` / `CF03(03 'exit')` | 通る |
| `CA24` | 通る |
| **`CFNN`** | **通らない** |
| **`CFNN()`**（いまの `＋` が書く形） | **通らない** |
| `CF00` | 通らない |
| `CF25` | 通らない |

原典（`CAnn` / `CFnn` の詳細ページ）の「CA01 - CA24」「CF01 - CF24」と一致する。

### F3: **空の括弧は誤りではない**（範囲を広げないための確認）

`＋` は `hasParameters !== false` のとき `名前()` を書く。引数が**任意**の
キーワード（DSPF に 30 件）にも括弧が付くので気になったが、実機は通す:
`PRINT()` / `OVERLAY()` / `CLEAR()` / `CF03()` はいずれも**通る**。

`SFLEND()` は通らなかったが、**対照（`SFLEND` を括弧なしで書いた形）も通らない**
——素のサブファイル（`SFLEND` なし）は通るので、原因は括弧ではなく `SFLEND`
そのものの前提条件。**括弧の是非はこの件では判定できない**ので、
「空の括弧は誤り」とは言わない。別項目に回す。

### F4(Q3): 範囲は**原典の説明文から取れる**

`dds-keywords.json` の `description` に入っている:

- 日本語: 「…機能キー **(CF01 - CF24)** が使用可能なことを…」
- 英語: 「…the function key specified in the keyword **(CF01 through CF24)** is…」

**区切りが日英で違う**（`-` と `through`）。両方を読む必要がある。
書き写さずに済むので、原典が変わったら表示も変わる。

### F5(Q4): いまの `＋` の書き出し

`src/dds/webview/ui.ts` の `addKeywordButton` の `Enter` 側:

```ts
const name = input.value.trim().toUpperCase();
if (name.length === 0) return;
const help = findKeywordHelp(name, this.keywordHelp);
const added = help?.hasParameters === false ? name : `${name}()`;
this.sendKeywords(sourceLine, `${keywords} ${added}`.trim());
```

`toUpperCase()` が `CFnn` → `CFNN` にしている。`findKeywordHelp` は
`CF03` を総称 `CFnn` に正規化して引けるので、**番号入りの名前は既に扱える**。

## 影響範囲

- `src/core/dds/ddsKeywords.ts` — 総称の判定と範囲の取り出し。
- `src/dds/webview/ui.ts` — `＋` の確定時の分岐。

## 実現性 / リスク

- 番号を検査しない方針（要件の対象外）なので、**総称のまま送らせない**だけで足りる。
- 総称の判定は「名前に小文字が残っている」で足りる（F1 より 2 件しか無く、
  どちらも `nn`）。ただし**将来 `xx` のような別の綴りが来ても効く**形にする。

## 実装アンカー

- A1: 候補の確定（`src/dds/webview/ui.ts` の `addKeywordButton` 内の `keydown`）。
- A2: 総称の正規化（`src/core/dds/ddsKeywords.ts` `findKeywordHelp`）——
  既に `CF03` → `CFnn` の正規化を持っているので、**同じ判定を使い回す**。

## 実装時の注意

- **`toUpperCase()` が犯人**。名前をそのまま大文字にすると総称が壊れる。
- 範囲の取り出しは**日英の区切りの違い**を吸収する（F4）。

## spec への申し送り

- 範囲は**原典のデータから**取る（AC3）。書き写すと原典が変わったときに食い違う。
- 番号の検査はしない（既存の「候補は入力の助けであって検証ではない」方針）。
