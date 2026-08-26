# レビュー: 07-editor-webview

subtask の review。**この slice 単独**の欠陥を見る（結合は親の統合 review）。

## ラウンド 1（2026-08-26）

### 観点と対象

`render/layout` `render/model`（core）／`editorProvider` `edit` `webviewHtml`（拡張）／
`webview/{protocol,bridge,geometry,ui,main}`（WebView）／`dev/`（検証用ハーネス・e2e）。
requirement AC1/AC2/AC3/AC6/AC8、spec D2/D3/D5、design DD1〜DD9、AGENTS.md の波及チェック。

### must-1: 削除すると**行が消えず、後続の行が複製される**（VSCode 経路のみ）

`edit.ts` の `lineReplacement` は `changedLines` を**新テキストの座標**で解釈しているが、
`editorProvider` はその範囲を**旧文書の置換範囲**として使っている。
行数が変わらない操作（移動・リサイズ）では一致するので気付かないが、**削除では壊れる**。

実測（4 行の DDS から 1 項目を削除）:

```
changedLines = {start:1, end:3}   旧 4 行 → 新 3 行
provider の置換: 旧 [1,3) の 2 行 ← 新 [1,3) の 2 行   → 行数が減らない
結果: ["R R1", "F2", "* コメント", "* コメント"]   ← コメント行が複製される
```

**AC2（編集行以外がバイト不変）と AC3（コメントが失われない）を破る。**

- 見逃した理由: 単体テスト（`ddsEditorEdit.test.ts`）が**移動しか通していなかった**。
  e2e はスタンドアロンのホストを通るが、そちらは `result.text` をそのまま採るので
  `lineReplacement` を経由しない——**2 つの検証手段が揃って同じ穴を持っていた**。
- 直し方: `lineReplacement` に旧テキスト（または旧行数）を渡し、
  **旧文書側の終端を `新終端 + (旧行数 - 新行数)` で求める**。挿入（旧範囲が空）と
  末尾追加（改行の有無）を provider 側で分岐する。
- 再発防止: **4 操作すべて**について「置換結果が `applyOps` の `text` と一致する」ことをテストで固定する。

### should-1: 予期しない例外で WebView が「適用中…」のまま固まる

`applyPatch` は `PatchRejectedError` 以外を `throw` する。呼び出しは `void this.applyPatch(...)` なので
**誰も受け取らず、WebView へは何も返らない**。UI は `Pending` から戻れず、以後の操作を受け付けない
（design「WebView の状態遷移」で `Pending` 中は編集を受け付けない設計にしているため）。

→ 例外を捕まえて `rejected` を返し、ログに残す。**編集を止めるより、理由を見せて操作可能に戻すほうがよい。**

### should-2: 構造変更のあと、選択 ID が別のアイテムを指しうる

04 の設計どおり ID は再パースで振り直される。実測:

```
元:     R1#1=F1 R1#2=F2 R1#3=F3
削除後: R1#1=F1 R1#2=F3      ← F3 が R1#2 になる
```

UI は `selectedId` を保持したままなので、**削除の直後に Delete をもう一度押すと、
選択したつもりのない項目（旧 F3）が消える**。

→ 構造を変える操作（`addItem` / `removeItem`）の適用後は**選択を解除する**。

### nit-1: `RenderItem.sourceLine` の追加が `decisions.md` に未記録

design の `RenderItem` には無いフィールドを足している（`openSource` に必要）。
`segments`（D2）・`code`（D3）は記録済みなので、これも揃えて残す。

### nit-2: `dds/model.ts` のコメントが実挙動と食い違う（03 の成果物・本 subtask の範囲外）

> 採番後は再利用しない——削除しても他のアイテムの番号を詰めない。

実際は**再パースで詰まる**（上記 should-2 の実測）。04 `decisions.md` D3 の
「構造変更後は ID が振り直される」が正しい。**この記述を信じて UI を書くと should-2 の罠にはまる**
（実際にはまった）。親の統合 review で訂正するのが妥当。

### 判定

**must 1 件 / should 2 件 / nit 2 件** → coding へ差し戻す。

## ラウンド 2（2026-08-26・差し戻し対応後）

### 対応の確認

- **must-1 解消**: `lineReplacement(oldText, newText, changedLines)` に変更し、
  旧文書側の終端を `新終端 + (旧行数 - 新行数)` で求める形にした。provider は挿入 / 削除 / 置換の
  3 形に分岐する（末尾に改行が無い文書への追記も扱う）。
  **4 操作すべてで「置換結果 ＝ `applyOps` の `text`」を突き合わせるテスト 5 本**を追加し、
  削除でコメント行が複製されないことを明示的に固定した。
- **should-1 解消**: 想定外の例外も `rejected` として返す。UI が `Pending` に取り残されない。
- **should-2 解消**: `addItem` / `removeItem` の適用後は選択を解除する（`pendingOp` で判定）。
- **nit-1 解消**: `decisions.md` D17 に記録。
- **nit-2 解消**: `dds/model.ts` のコメントを実挙動に合わせ、
  「ID を保持する側が構造変更後に捨てる責任を持つ」ことを明記した。

### 再点検（ラウンド 1 と同じ観点）

- **要件適合**: AC1（39-44 桁の更新）・AC2（編集行以外バイト不変）・AC3（opaque 保持）・
  AC6（DBCS の表示桁）は単体と e2e の双方で固定。AC8 は静的確認のみで、実挙動は親の統合 test へ。
- **価値適合**: requirement の「桁位置を手で数えることなくマウス操作で組み立てられる」に対し、
  L1 の 4 操作すべてが GUI から効き、**桁は core の計算で決まる**（UI は文字を数えない）。
  「実機の見え方と一致していることを機械的に確認できる」に対しては、
  `render/layout` の共有により **05 のゴールデンが GUI の配置の担保も兼ねる**。
- **規約適合**: `contributes.languages` / `grammars` は無変更、`priority: "option"`、
  `fileScope.ts` 無変更（AGENTS.md の波及チェック）。コアに `vscode` 依存なし（CI ガード）。
  WebView 側は `types: []` の別 tsconfig で **`vscode` を型の側から締め出している**。
- **保守性**: 判断は core、UI は描画のみ、`acquireVsCodeApi` は bridge の 1 か所。
  スタンドアロンで UI を無改造のまま動かせることを実際に確認済み（D11・D13）。

### 未検証（親の統合 test / deliver へ引き継ぐ）

- **AC8**（`.dspf` の既定エディタ・ルーラー / SOSI）と `WorkspaceEdit` の実適用（VSCode 必須）。
- **拡張の統合テストは現状回らない**——既存の `F4 Prompter Integration` が
  `await executeCommand("rpgClSupport.showPrompter")` で永久に返らない（07 `decisions.md` D10）。
  **親の統合 test を回す前に要修正**。
- e2e は CI 非搭載（`playwright-core` 手動導入）。

### 判定

**must 0 件 / should 0 件 / nit 0 件**。review を通過とする。
