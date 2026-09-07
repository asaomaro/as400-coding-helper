{{! RPGUnit テスト結果の出力書式。tools/run-rpgunit.mjs --md がこれを読んで埋める。 }}
{{! 使える記法は 3 つだけ:                                                          }}
{{!   {{key}}            値を埋める                                                 }}
{{!   {{#key}}…{{/key}}  配列なら繰り返し / 真なら 1 回 / 偽・空なら丸ごと省く      }}
{{!   {{! … }}           注記（出力されない）                                       }}
# テスト結果: {{pgm}}

| | |
|---|---|
| 判定 | **{{verdict}}** |
| 対象 | `{{suiteName}}` |
| 実行日時 | {{timestamp}} |

## 集計

| テスト | 合格 | 失敗 | エラー |
|---:|---:|---:|---:|
| {{tests}} | {{passed}} | {{failures}} | {{errors}} |

## 実行条件

| | |
|---|---|
| ソース | `{{source}}` |
| ソースタイプ | {{srctype}} |
| バインドした対象 | {{bind}} |
| 実行順 | {{order}} |
| 独立性の検品 | {{independence}} |
| 期待値の出所 | {{oracleSummary}} |

## テストケース

| | テスト | 判定 | 出所 | assertions | 時間 |
|---|---|---|---|---:|---:|
{{#cases}}
| {{mark}} | `{{name}}` | {{result}} | {{kind}} | {{assertions}} | {{time}} |
{{/cases}}

{{! 出所が「特性化」のものは網羅に数えない（skill §0.4）。 }}
{{#hasOracleProblems}}
## 期待値の出所が不明なテスト

次のテストは**どこから来た期待値かが書かれていません**。合格していても
「仕様どおり」の根拠にはならず、**網羅の数にも入れられません**。

| テスト | 理由 |
|---|---|
{{#oracleProblems}}
| `{{name}}` | {{reason}} |
{{/oracleProblems}}

実装を読んで期待値を書いたなら `CHARACTERIZATION` と名乗らせてください
（skill `rpgunit-test` §0.2）。

{{/hasOracleProblems}}

{{#hasFailures}}
## 失敗の詳細

{{#failed}}
### {{name}}

{{message}}

```
{{detail}}
```

{{/failed}}
{{/hasFailures}}
{{#hasIndependenceDiff}}
## 独立性の食い違い

正順と逆順で合否が違うテストがあります。**前のテストが残したもの**（DB の行・
活動化グループのグローバル・ジョブログのメッセージ）を `tearDown` で片付けてください。

| テスト | 正順 | 逆順 |
|---|---|---|
{{#independenceDiff}}
| `{{name}}` | {{a}} | {{b}} |
{{/independenceDiff}}

{{/hasIndependenceDiff}}
## 環境

| | |
|---|---|
{{#properties}}
| {{name}} | `{{value}}` |
{{/properties}}

---

生成: `tools/run-rpgunit.mjs --md`（書式は `.claude/skills/rpgunit-test/templates/test-report.md`）
