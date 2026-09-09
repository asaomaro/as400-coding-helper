# タスク: DDS を一から作れるようにする（新規作成とレコード様式）

進捗の単一の真実。coding 工程で 1 つずつ消す。

## 要件の整合

- [x] T1: `requirement.md` の **AC-I2 を AC7 に合わせて直す**（依存: なし）
  - いまの AC-I2 は「削除は**確認を経てから**消え」で、AC7（2026-09-08 に「確認ダイアログは出さない」へ
    書き換え済み）と矛盾する。**AC7 が後の判断**なので、AC-I2 を
    「削除は**即座に効き**、undo で元に戻る」に直す。
  - 直した理由を 1 行添える（後から「なぜ緩めたのか」を追えるように）。

## core: 行の組み立てと雛形

- [x] T2: `buildRecordLine(name)` を `src/core/dds/ddsEditWriteBack.ts` に足す（依存: なし）
  - 17 桁目に `R`、19-28 桁に名前（大文字）。桁は `DDS_COLUMNS` から採り、**ここで数えない**。
  - 検証: 出力が `     A          R MAIN` と同じ形（既存サンプルの行と一致）。

- [x] T3: `src/core/dds/ddsTemplate.ts`（新規）に `buildDdsTemplate(ddsType)`（依存: T2）
  - DSPF: `buildKeywordLine("DSPSIZ(24 80 *DS3)")` ＋ `buildRecordLine("REC1")`
  - PRTF: `buildRecordLine("REC1")`（**画面サイズ相当は入れない**。D8）
  - 検証: DSPF の雛形を `buildDspfRenderModel` に通すと
    `canvas 24x80` / `outline` 1 件 / `diagnostics` 0 件。

## core: `records` の導き方（★AC2 の壁）

- [x] T4: `records` を `layout.items` ではなく `outline` から作る（依存: なし）
  - `dspfRenderModel.ts:215` と `prtfRenderModel.ts:94`。名前の無い束（「（様式の外）」）は外す。
  - **`fromLayout` / `fromPrtfLayout` の `outline` 引数の既定値 `= []` を外す**（渡し忘れが
    黙って `records: []` になるのを防ぐ）。呼び出しは PJ 内 2 か所でどちらも渡している。
  - **回帰テストを先に書き、直す前の状態で落ちることを確かめる。**
    期待値: `[DSPSIZ, "     A          R REC1", ""]` → `records: ["REC1"]`（いまは `[]`）。
  - 既存の 3 件（`dspfRenderModel` / `prtfRenderModel` / `ddsEditorWiring`）が通り続けること。

## core: 様式の追加と削除

- [x] T5: 名前の検査を `validateRecordName(units, name, exceptSourceLine?)` に切り出す（依存: なし）
  - `validateRecordRename`（`ddsEdit.ts:1139`）が使っていた 3 つ（空 / 10 桁超 / 重複）をそのまま移し、
    改名側もこれを呼ぶ。**写さない**（片方だけ緩めると黙って守りが消える）。
  - **文字種は見ない**（原典に規定が無く、改名も見ていない）。

- [x] T6: `addRecord` を足す（依存: T2, T5）
  - `DdsEdit` に `{ kind: "addRecord"; name: string }`。拒否コードは既存の 3 つ。
  - 挿入点＝**最後の非空白行の直後**（`isDdsBlankLine` でない最後の行の次。すべて空白なら 0）。
    `insertionPoint`（`ddsEdit.ts:871`）は**流用しない**（あれは「様式の中の末尾」）。
  - 検証: 空ファイル `[""]` → 行頭に空行を残さない ／ ファイル・レベルのキーワードだけの
    ファイル → その下に付く ／ 末尾の空行の前に入る ／ 同名は拒否。

- [x] T7: `removeRecord` を足す（依存: T5）
  - `DdsEdit` に `{ kind: "removeRecord"; sourceLine: number }`。
  - 様式の論理単位から**次の `record` 単位の手前まで**の `sourceLines` を集め、
    `removalRuns`（`ddsEdit.ts:847`）と同じ流儀で**連続する塊ごと**の削除指示にする。
  - 検証: 中の項目が消える ／ **注記行・空行は残る** ／
    **位置の上書き行（`*DS4` の行）も一緒に消える**（孤児にしない） ／
    様式でない行を指したら `record-line-not-found`。

- [x] T8: `src/core/dds/ddsDanglingReferences.ts`（新規）＋ 両モデルの `diagnostics` に足す（依存: なし）
  - `findDanglingReferences(outline, fileKeywords)` が
    `record-reference-not-found` / `field-reference-not-found` を返す。
  - 参照の抽出は `findRecordReferences` / `findFieldReferences` を**そのまま使う**（規則を写さない）。
  - `RenderDiagnosticCode` に足し、`buildDspfRenderModel` / `buildPrtfRenderModel` の末尾で加える。
    **`fromLayout` / `fromPrtfLayout` には足さない**（生の行を持たないので名前の集合を作れない）。
  - 検証: 同梱の DDS 8 本（`CUSTMNT` / `CUSTRPT` / `RENDER1` / `PRTTST` / `CONTTST` ＋
    単独起動の `references` / `indicators` / `report-emphasis`）で **0 件**（偽陽性の固定） ／
    `SFLCTL` の指す様式を消すと 1 件出る。

## 継ぎ目

- [x] T9: `src/dds/webview/protocol.ts` の `parseEdit` に 2 種類（依存: T6, T7）
  - `addRecord`（`name` が文字列）／ `removeRecord`（`sourceLine` が正の整数）。
    中身の検査は core に任せ、**ここは型だけ**（`renameRecord` と同じ）。
  - `HostMessage` / `EditorHost` は**増やさない**（新規作成はホストの殻の仕事）。
  - 検証: 不正な形（数値の `name`、0 や負の `sourceLine`）で列ごと捨てる。

## UI

- [x] T10: `recordAt` に「選択中の様式」を挟む（依存: T4）
  - `ui.ts:2442`。順は ①行の見当 → **②選択中の様式（項目を選んでいるならその親）** → ③`records` の末尾。
  - 行→様式の見当そのものは変えない（DSPF の様式は画面行が重なりうる）。

- [x] T11: 一覧の見出しに `＋` と名前の入力欄（依存: T9）
  - 置き場は `template()` の左ペインの **`pane-head`**。**`renderOutline` の中に置かない**
    （項目 0 件で早期 return するため、様式 0 件のファイルで消える＝AC12 が落ちる）。
  - 約束は `addKeywordButton`（`ui.ts:1466`）を写す:
    `＋` → `hidden` を外して `focus()` ／ `Enter` で送る（空なら何もしない） ／
    `Escape` で閉じて `＋` へ `focus()` を戻す ／ **`blur` では確定しない**。
  - `maxLength = 10`。拒否されたら**入力欄を閉じず**、理由を `setStatus` に出す。
  - `ui.css` に `.rec-add` / `.rec-add-input`。

- [x] T12: 様式の `✕` と削除の状態表示（依存: T9）
  - `renderOutline`（`ui.ts:879`）の `li.record` に、**名前がある様式だけ** `✕` を置く。
  - **確認せず** `removeRecord` を送る（D4）。`Delete` キーには割り当てない。
  - 送る**前に** `model.outline` から件数を採り、`pendingStatus` に
    `EMPDTL を削除しました（項目 7 件）`（AC7）。
  - `pendingStructural` を true にする（行がずれるので選択を捨てる）。

- [x] T13: 確定後の選択と focus（依存: T11, T12）
  - `pendingSelectRecord`（**様式名**。行番号では追えない）を足し、`applied` で
    `model.outline` から名前で引いて `selected` に入れ、描画後に見出しへ `focus()`。
  - 追加 → 足した名前 ／ 削除 → 一覧上の隣（前があれば前、無ければ次） ／
    様式が 0 件になったら `＋` へ `focus()`。

## ホスト

- [x] T14: VSCode の新規作成コマンド 2 つ（依存: T3）
  - `rpgClSupport.newDspf` / `rpgClSupport.newPrtf` を `editorProvider.ts` に登録。
  - `showSaveDialog`（**`filters` は付けない**）→ 取り消しなら何もしない →
    `resolveDdsType` が目的の種別でなければ既定の拡張子を足す →
    `workspace.fs.writeFile`（`\n` / UTF-8）→ `executeCommand("vscode.openWith", uri, VIEW_TYPE)`。
  - **引数は `(uri, viewType)` の順**——逆にすると無言で失敗する。
  - `package.json` に `commands` 2 件と `menus.explorer/context` 2 件
    （`when: explorerResourceIsFolder`）。`editor/context` には置かない。
  - 書き出し失敗・`openWith` 失敗は `showErrorMessage`（黙らせない）。

- [x] T15: 単独起動の新規作成ボタン 2 つ（依存: T3）
  - `dev/standalone.html` の帯に `新規 DSPF` / `新規 PRTF`、`dev/standalone.ts` で
    `host.load("NEWDSPF.dspf", buildDdsTemplate("DDS-DSPF").join("\n") + "\n")`。
  - 種別は**ファイル名の拡張子**で決まる（`ddsType()`）。ファイルシステムは要らない。

- [x] T16: `docs/origin/verify-contributes.mjs` に到達性の検査（依存: T14）
  - 2 コマンドが `contributes.commands` と `explorer/context` にある。
  - **新規作成が使う既定の拡張子**（`.dspf` / `.prtf`）が
    `customEditors[].selector` と `sourceKind.ts` の**両方**に載っている
    （載っていないと「作れるのに開かない」ファイルができ、AC1 が落ちる）。

## 実操作の検証

- [x] T17: `dev/e2e.mjs` に節を足す（依存: T13, T15, T8）
  - 新規 DSPF → ソース面に `DSPSIZ` と `R REC1` が出る
  - **そのまま定数を置ける**（AC2 の本丸。ソースに行が増える）
  - `＋` → 名前 → `Enter` → 一覧に増え、**その見出しが選択されている**
  - `Escape` → 何も増えない
  - `✕` → 様式と中の項目が消え、状態行に件数が出る
  - 「元に戻す」→ 戻る
  - **`rm -rf out out-test` してから走らせる**（旧名のコンパイル結果を二重に実行しない）
