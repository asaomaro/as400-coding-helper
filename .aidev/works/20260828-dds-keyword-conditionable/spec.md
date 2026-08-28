# 仕様: 条件付けできないキーワードを知らせる

## 設計方針

**原典の決まり文句を機械で読む。** 各キーワードの詳細ページは可否を定型文で書いている:

- 付けられない: 「オプション標識は、このキーワードでは無効です。」（112 ページ）
- 付けられる　: 「このキーワードについては、オプション標識を使用することができます。」（53 ページ）ほか

**当たりは実機で錨を打つ。** 抽出は正規表現なので、原典の中だけでは当たっているか分からない。
`20260827-dds-conditional-edtcde` で `CRTDSPF` に通した 5 件を検査に埋め込む。

## 対象範囲

- `docs/origin/generate-dds-conditioning.mjs`（新規）
- `docs/origin/verify-dds-conditioning.mjs`（新規）
- `vscode-extension/resources/completion/dds-conditioning.json`（生成物）
- `src/core/dds/ddsConditionable.ts`（新規）— 表の引き方
- `src/core/dds/dspfLayout.ts` / `prtfLayout.ts` — 指摘
- `src/lint/{types,rules/index,rules/layout}.ts` ＋ `package.json` — lint 規則

## インターフェース / データ構造

```jsonc
{
  "keywords": {
    "DSPF":  { "DSPATR": true, "EDTCDE": false, ... },   // 153 件
    "PRTF":  { "SPACEA": true, "EDTCDE": false, ... },   //  64 件
    "PF-LF": { }                                          // 条件付け欄の意味が違う
  },
  "counts": { "DSPF": { "yes": 63, "no": 90, "unknown": 17 }, ... }
}
```

```ts
export function isConditionable(ddsType, keyword): boolean | undefined;
export function unconditionableKeywords(ddsType, keywords): string[];
```

診断コード / 規則 ID: `keyword-not-conditionable` / `layout-keyword-not-conditionable`。

## 振る舞いの詳細

### ひっかけ

付けられないキーワードの多くは続けて
「ただし、オプション標識を使用して、**このキーワードが指定されているフィールドの条件付け**を
行うことはできます。」と書く。**これは逆のことを言っていない**——素朴に「使用できます」を
拾うと答えが反転する。この文は数えない。

### 分からないものは咎めない

原典が可否を書いていないキーワードがある（DSPF 17 / PRTF 1）。`undefined` を返し、
指摘しない。「知らない＝付けられない」にすると**実機で通るソースを弾く**。

### 代表行は対象外

`keywordGroups[0]` のキーワードは項目自身の条件で決まる。
「キーワードに条件を付けた」ことにはならないので見ない。

### `nn` の総称

`CA03` は原典の総称 `CAnn` に正規化して引く（解説の引き方と同じ規則）。
表の鍵は読み込み時に大文字へ揃える——`"CAnn".toUpperCase()` は `CANN` なので、
片方だけ揃えると黙って引けなくなる。

## エラー処理 / 異常系

指摘は**助言**であって編集を止めない（`decisions.md` D3）。

## 受け入れ基準との対応

- AC1: `unconditionableDiagnostics`（両方の解決器）
- AC2: `generate-dds-conditioning.mjs`
- AC3: `verify-dds-conditioning.mjs` の `MACHINE`
- AC4: `layout-keyword-not-conditionable`（既定 ON・error）＋ `package.json` の設定
- AC5: `isConditionable` が `undefined` を返す
- AC6: `resolveKeywordGroups(unit).slice(1)`
