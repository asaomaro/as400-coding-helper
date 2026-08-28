# 調査: 継続行にまたがる参照

## 調査の問い

- Q1: いまの追随はどこを見ているか。
- Q2: 継続の run はどう取れるか。
- Q3: run をまとめて書き換えると、前 work で踏んだ回帰（関係のない行が畳まれる）が
  再発しないか。

## 判明した事実

### F1(Q1): 物理行の生のキーワード欄を見ている

`renameReferenceResults`（`src/core/dds/ddsEdit.ts`）は
`lines.forEach` で 1 行ずつ `keywordAreaOf(line)` を取り、置き換えている。
継続の後ろ側の行は `COL)` だけなので、`findFieldReferences` はキーワードを見つけられない
（`splitKeyword` が `(` を見つけられず undefined を返す）。

### F2(Q2): `joinContinuations` が run を返す

`src/core/dds/ddsLogicalUnits.ts:287`。返るのは
`{ index（代表行・0 始まり）, keywords（結合後）, sourceLines（1 始まり・継続を含む）}`。
継続の規則（`-` は空白を挟まず / `+` は先頭の空白を捨てる / 記号なしで引用符が
開いていれば空白 1 つ）は**実機で確定済み**（`20260827-dds-keyword-continuation`）。

### F3(Q3): **再発しない**——単独のキーワード行は別の run

前 work の回帰は「**論理単位**のキーワード区間」をまとめて置き換えたことが原因だった
（`R MAIN` ＋ その次の `CSRLOC` 行が 1 つの区間になり、折り直しで 1 行に畳まれた）。

`joinContinuations` は**継続記号でつながった行だけ**をまとめる。
`R MAIN`（機能欄が空）は継続にならないので、次の `CSRLOC` 行は**別の run**。
したがって run 単位で折り直しても、あの畳み込みは起きない。

### F4: 折り直しは**実機で通る**

継続の run を書き換えると `foldKeywordArea` が走り、**行数が変わりうる**
（実測: `SFLCTL(SFLREC) + / CSRLOC(CSRROW + / CSRCOL)` の 3 行が
`SFLCTL(SFLREC) CSRLOC(NEWROW NEWCOL)` の 1 行になった）。
その形が実機でコンパイルを通ることを確認済み（`verify/verify-continued-rename.mjs`）。

**対照が要る**——最初 `SFLCSRRRN` を素の様式に書いて対照ごと落ちた
（`SFLCSRRRN` はサブファイル制御レコードにしか書けない）。
対照を置いていなければ「折り直した形が通らない」と誤読していた。

## 影響範囲

- `src/core/dds/ddsEdit.ts` の `renameReferenceResults` だけ。表も UI も変えない。

## 実現性 / リスク

- 折り直しで**行数が変わる**。`applyDdsEdits` は行番号の降順で返すので、
  当てる側はいままでどおりで足りる。
- 折り方が元と変わりうる（`+` で折られていたものが 1 行に収まる等）。
  避けられない——名前の長さが変われば桁も変わる。

## 実装アンカー

- A1: `src/core/dds/ddsEdit.ts` `renameReferenceResults`（`lines.forEach` の走査）。
- A2: `src/core/dds/ddsLogicalUnits.ts:287` `joinContinuations`。

## 実装時の注意

- **run が 1 行なら今までどおり**その場で差し替える（見た目を変えない）。
  折り直すのは継続の run だけ。
- 代表行が改名の宛先なら触らない（別の指示が同じ行を書き換えている）。

## spec への申し送り

- AC4（単独のキーワード行が畳まれない）は**前 work の回帰**なので、
  テストで明示的に固定する。
