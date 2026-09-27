# タスク: 1 行に収まらない定数を継続行に分けて書く

## 作業順序と依存関係
T1 → T2 → T3。

## テスト方針
`npm test`（足したテストは実装を外すと落ちることを確かめる）。実機で `CRTDSPF` / `CRTPRTF`（T3）。

## タスク
- [x] T1: `buildItemLines(item)` を足す（定数は `foldKeywordArea(quoteLiteral(text))` の 1 つ目を代表行、2 つ目以降を継続行）。単体テスト。
      対象: `vscode-extension/src/core/dds/ddsEditWriteBack.ts:223` `buildItemLine` の隣 / `vscode-extension/test/unit/ddsEdit.test.ts`
      依存: なし
      AC: AC1, AC4
- [x] T2: `ddsEdit` の `add` で `buildItemLines` を使う。読み直しの単体テスト（文字列が戻る・後続の様式が変わらない）。
      対象: `vscode-extension/src/core/dds/ddsEdit.ts:669`
      依存: T1
      AC: AC2, AC4
- [x] T3: 実機で確かめる（半角 80・全角 38 の定数を置いた画面と帳票を `CRTDSPF` / `CRTPRTF`、画面を 5250 で表示）。
      対象: 未特定（`verify/` に確認の道具を置く）
      依存: T2
      AC: AC3

## 計画外で直したもの
- T3 の実機確認で、全角の罫線 38 本が画面で 17 本＋4 本に切れた。原因は `isDbcsCodePoint` の手書きの範囲に罫線（U+2500 台）が無く、
  1 桁と数えて折っていたこと（実機では SO/SI と 2 桁）。1 行が 116 桁になりメンバー（100 桁）からはみ出して消えていた。
  判定を実機の変換表（CCSID 5035 = IBM-939）から生成した表で引くように直した（`docs/origin/generate-dbcs-table.mjs` → `src/core/dbcsTable.ts`、
  `verify:defs` で `--check`）。約物（`「」、。` U+3000 台）・記号・ギリシャ/キリル文字も同じく漏れていた。
