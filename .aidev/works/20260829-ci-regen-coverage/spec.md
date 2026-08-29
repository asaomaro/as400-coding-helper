# 仕様: 生成物の再生成チェックを取りこぼしなくする

## 設計方針

### D1: 差分検査は `resources/` 全体を見る（列挙をやめる）

いまは `prompter/cl` / `navigation` / `completion` の**3 つを列挙**しており、
出力先が増えるたびに足す必要がある。**足し忘れても何も起きない**ので気付けない
（実際 `prompter/dds` `prompter/cmd` `prompter/rpg` の 3 つが漏れていた）。

**`vscode-extension/resources` 全体**を対象にする。列挙をやめれば同期漏れが構造的に起きない
（AGENTS.md「同じ概念集合を複数箇所で列挙しない」）。

`resources/` に生成物以外が入っているなら誤検出になるが、**再生成しても差分が出ない**限り
落ちないので、手で置いた資産があっても害は無い。

### D2: 足りない生成器を足す

- `generate-dds-columns.mjs --lang=en`（`20260829-dds-en-labels` で追加した出力）
- `generate-rpg-io-definitions.mjs`（I/O 仕様書の 8 定義。一度も CI で回っていない）

**順序の制約は既存のコメントどおり**に守る——`generate-cdml-rules` は CL 定義の後、
`generate-dds-keyword-levels` はキーワード表が出来てから。
（実際にこの順序を崩すと `prompter/cl/en` に 200 件超の差分が出ることを手元で確認した）

### D3: 本 PJ 側の「CI を整える」は既に済んでいる

backlog の項目は「lint core と as400-web-emulator のオフライン回帰を CI で」。
**本 PJ 側は既に回っている**:

| 何を | どこで |
|---|---|
| lint core の境界（vscode 非依存・対象拡張子） | `npm run verify` の `verify-lint-core.mjs` |
| 桁位置 lint（サンプルで指摘ゼロ） | `prompter-definitions.yml` の専用ステップ |
| 単体テスト | `npm test` |
| 統合・GUI e2e | `integration` / `gui-e2e` ジョブ |

**`as400-web-emulator` 側は別リポジトリ**なのでここでは閉じない。項目を割る。

## 対象範囲

| ファイル | 変更 |
|---|---|
| `.github/workflows/prompter-definitions.yml` | 再生成ステップに 2 つ追加／差分検査を `resources` 全体に |

**生成器・定義・テストは変更しない。**

## 受け入れ基準との対応

| AC | 満たし方 |
|---|---|
| AC1 | D2 |
| AC2 | D1 |
| AC3 | 手元で JSON を書き換え、同じコマンド列で落ちることを確かめる |
| AC4 | 手元で全生成器を CI の順序で回し、差分ゼロを確認済み |
| AC5 | D3。backlog を割って残件を明示 |
