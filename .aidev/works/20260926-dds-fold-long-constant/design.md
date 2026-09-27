# 仕様: 1 行に収まらない定数を継続行に分けて書く

## 概要
`ddsEdit` の `add` で、定数のリテラル（`quoteLiteral` で引用符を付けたもの）を `foldKeywordArea` に通し、1 つ目の塊を位置を持つ代表行に、
2 つ目以降を `buildKeywordLine` の継続行にする。

## 設計方針
- 折り方は既存の `foldKeywordArea` をそのまま使う（実機の桁で数える・DBCS の SO/SI を数える・1 つの語が 36 桁を超えると `-` で継続。
  生テキストの編集で既に使っている）。折り方を 2 か所に書かない。
- `buildItemLine` は 1 行を返す形のまま残し（既存の呼び出し・テストがある）、複数行を返す `buildItemLines` を足して `add` から使う。
- 読み直し（`toLogicalUnits` / `readConstant`）は `-` の継続を既に読める（生テキストの編集で折った定数を読んでいる）。変えない。

## 対象範囲
- `vscode-extension/src/core/dds/ddsEditWriteBack.ts`（`buildItemLines` を足す）
- `vscode-extension/src/core/dds/ddsEdit.ts:666-670`（`add` で使う）
- `vscode-extension/test/unit/`（単体テスト）

## 依拠する既存の事実
- `ddsEditWriteBack.ts:76-120` `foldKeywordArea`: `printWidth` で実機の桁を数え、36 桁を超える 1 語は `-` で切る。実機の境目は
  `.aidev/works/20260828-dds-line-width-columns/verify/probe-dbcs-width.mjs` で測定済み（同関数の注記の表）。
- `ddsEditWriteBack.ts:223-266` `buildItemLine`: 定数はキーワード欄に `quoteLiteral(text)` をそのまま付ける（折らない）。
- `ddsEdit.ts:669`: `add` は `lines: [buildItemLine(edit.item)]` の 1 行を差し込む。
- 実機は 81 桁目以降を読まない（v1 の実機コンパイルで CPD7508/CPD7596。`docs/research/20260927-dds-editor-exploration/findings.md`）。

## 受け入れ基準との対応
- AC1: `buildItemLines` の単体テスト（半角 80・全角 38・引用符を含む文字列）。入力は `NewDspfItem`。
- AC2: `applyDdsEdits`（`add`）を掛けたソースを `parseDds` 系で読み直し、定数の文字列と後続の様式を比べる単体テスト。
- AC3: 実機で `CRTDSPF` / `CRTPRTF`（`docs/research/20260927-dds-editor-exploration/compile.mjs`。CCSID 5035 のソース・ファイル）。
- AC4: 既存の単体テスト全件。
