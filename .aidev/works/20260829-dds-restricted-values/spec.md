# 仕様: DDS の値集合を原典どおりに直す

## 概要

生成器が読み落としていた 3 つの形を読めるようにし、**日本語版原典の誤植 1 件**を
実機の判定に合わせて直す。**`restricted` は今回付けない**（research F6）。

## 設計方針

### 1. 読み落としを 3 つ直す（すべて `parseDetail` の中）

| 形 | 対処 |
|---|---|
| 一覧の直後の「注」が値を足す | 「データ・タイプ」で始まり **DBCS を含む注だけ**を対象に `X (説明)` を採る |
| 「ブランクまたは 0」 | ブランクと値の**2 項目**として採る |
| 値の一覧が子ページにある | 選択肢が空のとき「有効な項目」リンクを追う |

**注の対象を狭く取る。** 注は他にもあり（「37 桁目に 0 を指定…」）、広く拾うと
関係の無い文字を値にする。

### 2. 原典の誤植は「置き換え」で直す

`ORIGIN_ERRATA` に**根拠つきで**書く（`BROKEN_EXAMPLES` と同じ作法）。

**消すのではなく置き換える。** 消すだけだと日本語版から**正しい値 `O` が失われ**、
利用者が 38 桁目に `O` を書けなくなる。

### 3. `restricted` は付けない

値集合が「完全だ」と言えるのは**実機で全値を判定した 38 桁だけ**（research F6）。
残り 4 欄は原典を読んだだけ。**部分的に有効にしない**（backlog の明示的な指示）。

→ backlog 項目を**割る**: 値集合の修復（済）と `restricted-value` の有効化（残り）。

## 対象範囲

| ファイル | 変更 |
|---|---|
| `docs/origin/sources.mjs` | 子ページを manifest に追加 |
| `docs/origin/manifest.yml` ＋ 取得した 2 ページ | 生成物 |
| `docs/origin/fetch-origin.mjs` | 併合の鍵を保存先パスから作る |
| `docs/origin/generate-dds-prompter.mjs` | 上記 1・2 |
| `resources/prompter/dds/{ja,en}/DDS-{PF,DSPF}.json` | 生成物（手で直さない） |
| `test/unit/ddsPositionalValues.test.ts` | 値集合の回帰 |

## 振る舞いの詳細

| 欄 | 前 | 後 |
|---|---|---|
| 表示装置 35 桁 | **選択肢なし（自由入力）** | ブランク X A N S Y W I D M F L T Z J E O G |
| 物理/論理 35 桁 | P S B F A H L T Z 5 | ＋ J E O G |
| 表示装置 38 桁(ja) | I B H M P | **ブランク O** I B H M P |
| 表示装置 38 桁(en) | I B H M P | **ブランク O** I B H M P |

## 受け入れ基準との対応

- **AC1**: 子ページが manifest にあり日英とも取得済み。
- **AC2**: 生成器が注・ブランクまたは X・子ページを読む。**再生成しても差分ゼロ**。
- **AC3**: `verify/pos38-result.json` ＋ メッセージ本文。対照 4/4。
- **AC4**: `restricted` は**どこにも付けない**。理由は research F6 に欄ごとに記録。
- **AC5**: **今回は既定 ON にしない**（AC4 の結果として）。backlog を割る。
- **AC6**: `npm test` 1128 / `npm run verify` 19 検査。
