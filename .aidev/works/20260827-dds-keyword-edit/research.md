# 調査: キーワード欄の編集

## 調査の問い

- Q1: 折り返しの規則は何か（前の work の成果を使えるか）。
- Q2: いまの書き戻しはどこを触っているか。何を壊しうるか。
- Q3: 追加の候補をどう出すか。PJ に既存の流儀はあるか。
- Q4: 編集の宛先（どの行を置き換えるか）はどう決まっているか。

## 判明した事実

### F1: 折り返しの規則は実機で確定済み

`20260827-dds-keyword-continuation` の research F1（実機 IBM i 7.3 の
`Expanded Source` で実測）:

- **`-`**: 記号を捨て、次行の **45 桁目ちょうど**から続く（空白を挟まない）。
- **`+`**: 記号を捨て、次行の**最初の非空白**から続く。
- 記号なしで引用符が開いていれば**空白 1 つ**を挟む。
- 「キーワードだけの行」は**空白 1 つ**で連結される（`toLogicalUnits`）。

→ 書き出しは 2 通りで足りる:
1. **キーワードの切れ目で折る**（次の行に置くだけ。連結は空白 1 つ）。
2. **1 つのキーワードが 36 桁に収まらないときだけ `-` で切る**（連結は空白なし）。

`+` は書き出しに使わない（`-` で足り、**先頭の空白を捨てる**ぶん再現性が落ちる）。

### F2: いまの書き戻しは**代表行の欄しか触らない**

`applyAttributes`（`src/core/dds/ddsEdit.ts`）は
`replaceLeadingConstant(keywordAreaOf(next), text)` → `writeBackKeywordArea(next, …)`。

- 対象は**代表行の 45 桁目以降だけ**。後ろの「キーワードだけの行」は**そのまま残る**
  （`ddsAttributeEdit.test.ts` が固定している）。
- 継続にまたがるとリテラルが読めず、前の work で `keyword-continuation` として**拒否**した。

### F3: 編集の宛先は `replaceFrom`/`replaceTo`（0 始まりの半開区間）

`DdsEditResult` は置き換え指示。削除は `removalRuns(unit)` が
`unit.sourceLines` から**連続する区間**を作っている。
キーワード欄の書き出しも**同じ形**で表せる——代表行から始まる区間を置き換える。

**区間が連続していない場合がある**: 項目とキーワード行の間に注記行が挟まると、
`toLogicalUnits` は注記を飛ばして連結するので `sourceLines` が飛び飛びになる。
この場合に区間で置き換えると**注記が消える**。

### F4: 追加の候補は**既にモデルに載っている**

`RenderModel` は `load` で**原典のキーワード表**（176 件）を受け取っている
（`20260826-dds-keyword-help`）。`level`（`file`/`record`/`field`）も入っているので、
**その項目のレベルで絞れる**。

PJ に候補入力の既存の流儀は無い（プロンプターはホスト側の入力箱を使う）。
WebView だけで完結する手段としては **`<datalist>` 付きの `<input>`** が素の HTML で使え、
ホストの入力箱（`askItem`）のようなプロトコルの追加が要らない。

### F5: 使用レベルの判定は当てにしない

`resolveDdsLevel`（`src/language/ddsKeywordCompletion.ts`）は行を遡ってレベルを決めるが、
**デザイナ側は `OutlineItem` / `OutlineRecord` を選んでいる**ので、
様式なら `record`、項目なら `field` と直接分かる。遡る必要が無い。

ただし**絞り込みは候補の並びにだけ効かせる**（`level` を持たないキーワードが 18 件あり、
絞ると消える）。**書けるかどうかの検証には使わない**——誤ると正しい記述を拒否する。

## 影響範囲

- `src/core/dds/ddsEditWriteBack.ts` — 折り返し（`foldKeywordArea`）と行の組み立て。
- `src/core/dds/ddsEdit.ts` — 新しい編集 `setKeywords`、継続にまたがる `text` の解禁、拒否 2 種。
- `src/dds/webview/protocol.ts` — `parseEdits` が新しい種類を通す。
- `src/dds/webview/ui.ts` / `ui.css` — チップの `✕`、`＋` の入力欄、生テキストの編集。

## 実現性 / リスク

- **リスク: 再レイアウト**。キーワード欄を書き出すと、後ろのキーワード行は**まとめ直される**
  （利用者が触っていない行が動く）。`setKeywords` は「欄全体を編集する」操作なので筋は通るが、
  **`setAttributes.text` は代表行だけを触る従来の経路を残す**（既存の期待を壊さない）。
- **リスク: 定数のリテラルが消える**。先頭のリテラルが無くなると `unitItemKind` が
  項目と認めず、**キャンバスから消える**。拒否する。
- **リスク: 往復が合わない**。折った結果を読み直して元に戻ることを、
  **定義から作った入力で総当たり**して確かめる（`verify-prompter-roundtrip.mjs` と同じ考え方）。

## 実装アンカー

- A1: 折り返し（`vscode-extension/src/core/dds/ddsEditWriteBack.ts`。
  `writeBackKeywordArea` が既にある）
- A2: 新しい編集（`vscode-extension/src/core/dds/ddsEdit.ts:45` `DdsEdit` /
  `:174` `applyDdsEdits` の switch / `:249` 付近の検証）
- A3: 区間の作り方の先例（同 `removalRuns`）
- A4: プロトコル（`vscode-extension/src/dds/webview/protocol.ts` の `parseEdit`）
- A5: UI（`vscode-extension/src/dds/webview/ui.ts` の `keywordSection`）

## 実装時の注意

- **`+` は書き出しに使わない**（`-` だけ）。読む側は両方を解釈する。
- **切れ目で折れるならそちらを優先する**。`-` は「1 つのキーワードが 36 桁を超える」ときだけ。
  そうしないと、普通の並びが読みにくい `-` だらけになる。
- **注記行が挟まったら拒否する**（区間で置き換えると注記が消える）。
- 折り返した行の 1-44 桁は**空白**（`     A` だけ）。位置や名前を写さない。

## spec への申し送り

- 新しい編集は `setKeywords`（欄全体の置き換え）。`setAttributes.text` は従来どおり
  代表行だけ——ただし**継続にまたがる場合だけ** `setKeywords` と同じ経路に回す（AC7）。
- 候補は `<datalist>`（プロトコルを増やさない）。
- 往復は**総当たり**で固定する。
