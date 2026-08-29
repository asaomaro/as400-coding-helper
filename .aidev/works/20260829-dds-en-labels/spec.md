# 仕様: 英語版 DDS 定義から日本語を無くす

## 設計方針

### D1: 英語の桁抽出は**リンクの文言**から採る（日本語版は触らない）

英語原典の平文は `Sequence number for printer files (positions 1 through 5)` で、
**数字の前**に `positions` が来る。既存の正規表現（`…(\d+)…桁目`）は構造が合わない。
無理に平文へ合わせると**ラベルが前の文を巻き込む**（試作で
`'A K ITMNBR ABSVAL A Sequence number'` になった）。

一方**リンクの文言は完全で境界が明確**:

```
<a href="…">Sequence number for printer files (positions 1 through 5)</a>
<a href="…">Data type for printer files (position 35)</a>
```

リンクから採ると、**日英で同じ桁構造**（試作で確認）が得られ、ラベルも
`Sequence number` / `Data type` と原典の見出しそのものになる。

**日本語版の経路は変えない。** 検証済み（`verify-dds-columns.mjs`）で、
ルーラーも同じ資産を読む。AGENTS.md も「ここで作り直すと同じ罠を二度踏む」と書いている。
英語は**新しい経路を足すだけ**で、既存の出力に触れない。

### D2: 補完するラベルも言語で切り替える

日本語版は、原典が書いていない欄を既定値で補っている
（表示装置は先頭 3 欄を「1-7」とまとめるので `順序番号` / `仕様書タイプ` / `注記` を補い、
書かれていないページには `キーワード項目`(45-80) を補う）。
**英語でも同じ欄が同じ理由で落ちる**ので、同じ位置に英語の既定値を補う。

### D3: 生成器の日本語じか書きを言語表に集める

`generate-dds-prompter.mjs` に散っている日本語を 1 か所にまとめる:

| 対象 | ja | en |
|---|---|---|
| 種別の名前（`TYPES[].title`） | 物理/論理ファイル | Physical/logical file |
| ファイルの説明 | `${title}の定位置項目（A 仕様書）` | `Positional entries for ${title} (A spec)` |
| 桁の書き方 | `（1-5 桁目）` | `(positions 1-5)` |
| ブランクの接頭辞 | `（ブランク）` | `(Blank)` |
| 値のラベル | `B（意味）` | `B (meaning)` |

**RPG と同じ考え方**——訳すのは説明とラベルだけで、
**桁・欄の名前・選択肢の値といった事実は訳文に入れない**（AGENTS.md）。
ここでは欄の名前も原典（英語版）から来るので、訳文ファイルは要らない。

### D4: 混入を検査で止める

`verify-dds-prompter.mjs` に「**`en/` の定義に日本語（ひらがな・カタカナ・漢字）が無い**」を足す。
RPG 側（`verify-rpg-spec-definitions.mjs`）と同じ趣旨。
落ちたときに**どのキーに何が入っていたか**を出す（直せないと検査の意味がない）。

## 対象範囲

| ファイル | 変更 |
|---|---|
| `docs/origin/generate-dds-columns.mjs` | 英語のリンク抽出／補完ラベルの言語対応 |
| `docs/origin/generate-dds-prompter.mjs` | 言語表（D3）／`dds-field-labels.en.json` を読む |
| `resources/navigation/dds-{keyword-columns,field-labels}.en.json` | **新規**（生成物） |
| `docs/origin/verify-dds-prompter.mjs` | 日本語混入の検査（D4）／桁の日英一致 |
| `resources/prompter/dds/en/DDS-*.json` | 再生成 |
| `test/unit/ddsPositionalValues.test.ts` | 英語版に日本語が無いことを固定 |

**`resources/prompter/dds/ja/` と `resources/navigation/dds-*.json`（ja）は 1 バイトも変えない。**

## 受け入れ基準との対応

| AC | 満たし方 |
|---|---|
| AC1 | D1〜D3。検査（D4）と単体テストで固定 |
| AC2 | リンクの文言をそのまま使う |
| AC3 | `verify-dds-prompter.mjs` の日英一致（既存）＋桁の一致を追加 |
| AC4 | 検査を足し、日本語を混ぜて落ちることを確認 |
| AC5 | 再生成後に `git diff` が ja 側に出ないことを確認 |
| AC6 | 通常の検証一式 |
