# 仕様: 確かめた欄だけを lint の対象にする

## 設計方針

**`restricted` の意味を「この列挙は網羅である」に固定する。**

生成器に `PROVEN_COMPLETE` を置き、**実機で全空間を試して原典と一致した欄だけ**を
`true` にする。選択肢を持つ他の欄は明示的に `false`。

`false` には副作用がある——`20260828-prompter-standalone`／`-open-choices` で
入れた仕組みにより、**画面が候補つきの自由入力になる**。
確かめていない欄で「原典に無いが実機が受ける値」（印刷装置 35 桁の `G` / `O`）を
書けるようになるので、**安全側と使い勝手が同じ方向を向く**。

## 対象範囲

| ファイル | 変更 |
|---|---|
| `docs/origin/generate-dds-prompter.mjs` | `PROVEN_COMPLETE` と `restricted` の出力 |
| `resources/prompter/dds/{ja,en}/DDS-*.json` | 生成物 |
| `src/lint/rules/index.ts` | `restricted-value` を `enabledByDefault: true` |
| `src/lint/rules/restrictedValue.ts` | 説明を現状に合わせる |
| `test/unit/ddsPositionalValues.test.ts` | 印の範囲と規則の発火 |
| `test/unit/lintRules.test.ts` / `lintCli.test.ts` | 既定の規則集合（**理由つきで更新**） |

## 受け入れ基準との対応

- AC1 → `verify/exhaustive-*.txt` ＋ `probe-confirm.mjs`（対照 4 件）
- AC2 → `PROVEN_COMPLETE` は `DDS-DSPF:38` の 1 件。他は `false`（research F4/F5 に理由）
- AC3 → `enabledByDefault: true`
- AC4 → 単体テストで `Z` と `0` を指摘することを確認
- AC5 → `docs/src` 11 件で 0 件
- AC6 → `npm test` 1134 / `npm run verify` 19
