# 設計: ファイル・レベルのキーワードを 1 つ目から足せるようにする

## 方針
- core に `addFileKeywords`（最初の様式の前に行を足す。様式が無ければ末尾）を足す。`setKeywords` は既存の行が要るので使えない。
  WebView の契約（`protocol.ts`）にも通す（通さないとホストが捨てる）。
- UI は「ファイル」の節を常に出し、行が無いときは仮の行（行番号 0）を置く。それを選ぶとファイル・レベルのキーワードの欄が出て、
  確定は `addFileKeywords` になる。足したあとは足した行を選ぶ。
- レベルの判定は検証の `keyword-wrong-level` と**同じ表**（`ddsKeywordLevels`。原典から生成し実機で 7 通り確認済み）。表に無いものは止めない
  （以前の「絞り込みは候補の並びにだけ」の注記は、判定を誤ると正しい記述を拒むことを恐れたもので、実機で確かめた表を使えばその懸念に当たらない）。
- 括弧が必須かは構文（`NAME[(…)]` なら省略できる）から判定する `requiresParameters`。必須なら生テキストの欄に `NAME()` を入れて括弧の中に焦点を置く。
- 空の括弧は `ddsSourceDiagnostics` の `empty-parameters`（検証タブ）。

## 受け入れ基準との対応
- AC1: `ddsEdit.ts`（`addFileKeywords`）・`protocol.ts`・`ui.ts`（`renderOutline` / `renderProperties` / `sendKeywords`）。`ddsEdit.test.ts`・`dev/e2e.mjs`。
- AC2: `ui.ts`（`addKeywordButton`）・`ddsEdit.ts`（検証）。`ddsEdit.test.ts`・`dev/e2e.mjs`。
- AC3: `ddsKeywords.ts`（`requiresParameters`）・`ui.ts`。`ddsKeywordEdit.test.ts`・`dev/e2e.mjs`。
- AC4: `ddsSourceDiagnostics.ts`。`ddsSourceDiagnostics.test.ts`。
- AC5: `verify/`。
