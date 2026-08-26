# タスク: DDS 編集能力の統合

- [x] T1: 桁範囲の置換を 1 か所にする。`ddsReplaceField(text, column, value)` を `ddsField` の対として足し、既存の `writeBackPosition` の内部実装（`replaceColumns`）をそれに寄せる。**既存テストがそのまま通ること**が完了条件（挙動を変えない）
      対象: `vscode-extension/src/core/ddsLayout.ts:38`（`ddsField` の隣）・`vscode-extension/src/core/dds/ddsPositionWriteBack.ts`（`replaceColumns`） / 根拠: spec D6
- [x] T2: 長さ欄の書き戻しと、新規行の組み立てを作る。`writeBackLength` は位置欄と同じ流儀（数値は右詰め・他の桁に触れない・行末の空白を落とす）。`buildItemLine` は `NewDspfItem` から DDS の 1 行を組む（フィールド＝名前/長さ/型/小数/使用/位置、定数＝位置＋引用符つきリテラル）（依存: T1）
      対象: `vscode-extension/src/core/dds/ddsEditWriteBack.ts`（新規） / 参照: `vscode-extension/src/core/dds/ddsPositionWriteBack.ts`（流儀）・`vscode-extension/src/core/ddsLayout.ts:14`（`DDS_COLUMNS`） / 根拠: spec D6・対象範囲
- [x] T3: 編集の型と**事前検証**を作る。`DdsEdit` / `DdsEditResult`（**旧範囲＋新行**）/ `DdsEditRejectionCode`（6 種）と `validateDdsEdits`。**判定は持たない**——「ソースに書けるか」だけを見る（重なり・はみ出しは `dspfLayout` の担当）（依存: T2）
      対象: `vscode-extension/src/core/dds/ddsEdit.ts`（新規） / 参照: `vscode-extension/src/core/dds/dspfLayout.ts:70`（`DspfPlacedItem`）・`ddsLogicalUnits.ts` / 根拠: spec D1・D3・D5・AC6・AC9
- [x] T4: `applyDdsEdits` の `move` / `resize` を実装する。**代表行 1 行だけ**を置き換える（`replaceFrom + 1 === replaceTo`）。位置欄は既存 `writeBackPosition`、長さ欄は T2（依存: T3）
      対象: `vscode-extension/src/core/dds/ddsEdit.ts` / 根拠: spec「4 操作の適用結果」・AC1
- [x] T5: `applyDdsEdits` の `remove` を実装する。**論理単位ごと**消す（キーワード継続行は直前に付き、条件付け行は次に付く）。**PR #108 の「代表行だけ消す」実装は移植しない**（依存: T3）
      対象: `vscode-extension/src/core/dds/ddsEdit.ts` / 参照: `vscode-extension/src/core/dds/ddsLogicalUnits.ts` / 根拠: spec D4, `research.md` F7・F8, 本 plan R1
- [x] T6: `applyDdsEdits` の `add` を実装する。**対象様式の最後の論理単位の直後**に 1 行挿入（`replaceFrom === replaceTo`）。様式が見つからなければ `record-not-found` で拒否（依存: T3, T2）
      対象: `vscode-extension/src/core/dds/ddsEdit.ts` / 根拠: spec D4・AC2, `research.md` F21
- [x] T7: core の単体テストを書く。4 操作の `DdsEditResult`／**削除が論理単位である**こと（継続行つき・条件行つきの両方）／追加が正しい様式に入ること／拒否 6 種／**対象範囲の外が 1 文字も変わらない**こと／複数操作が**行番号の降順**で返ること（依存: T4, T5, T6）
      対象: `vscode-extension/test/unit/ddsEdit.test.ts`（新規） / 参照: `vscode-extension/test/unit/dspfLayout.test.ts`（作法）・`docs/src/CUSTMNT.dspf`（材料） / 根拠: 本 plan「テスト方針」, AC4・AC5・AC7
- [x] T8: **符号位置（AC10）**を入れる。`35 桁 = S` かつ `38 桁 = B`/`I` のとき占有を +1 桁。**`fieldWidth` ではなく `occupancy` と はみ出し判定（`dataEnd`）に入れる**（`width` は描画に使われるため）。実機 8 通りの表を回帰テストにし、**既存テストの期待値が動いたら `decisions.md` に経緯を残す**（依存: なし）
      対象: `vscode-extension/src/core/dds/dspfLayout.ts:130`（占有）`:120` 付近（`dataEnd`）・`vscode-extension/test/unit/dspfSignPosition.test.ts`（新規） / 根拠: spec D7, `research.md` F19, 本 plan R2
- [x] T9: 描画モデルを作る。`dspfLayout` の結果を**描くための形**に翻訳し、**区切り（`segments`）**を足す（DBCS は SO/SI が桁を消費するので、リテラルをそのまま置くと 1 桁ずれる）。**判定は持たない**——配置・幅・診断は `dspfLayout` のまま
      対象: `vscode-extension/src/core/dds/dspfRenderModel.ts`（新規）・`vscode-extension/src/core/dds/dspfLayout.ts`（`dataType` の公開） / 根拠: spec D12, AC9
- [x] T10: **VSCode 非依存の UI 層**を作る。`protocol`（契約とホスト能力）・`bridge`（`acquireVsCodeApi` の唯一の呼び出し箇所）・`geometry`（セル座標の純関数）・`ui`（キャンバス。選択・ドラッグ・つまみ・キー・配置モード）。**UI は文字を数えない**
      対象: `vscode-extension/src/dds/webview/{protocol,bridge,geometry,ui,main}.ts`・`ui.css`（新規） / 根拠: spec D11・D12・D14, AC-I1〜AC-I5
- [x] T11: **2 つの器**を作る。VSCode 側は `CustomTextEditorProvider`（`priority: "option"`・仲介のみ）、単独起動側は `dev/standalone.ts`（`Bridge` の別実装）。**同じ UI が両方で動く**ことを実際に確かめる。ビルド経路（esbuild・型検査）も併せて整える
      対象: `vscode-extension/src/dds/editorProvider.ts`・`webviewHtml.ts`・`dev/standalone.*`・`esbuild.webview.mjs`・`tsconfig.webview.json`・`package.json`（`customEditors`） / 根拠: spec D11・D13, AC8
- [x] T12: 雑務を片づける。`.gitignore` に `.vscode-test/`（統合テストが落とす VSCode 本体・1.2GB）を追加。`.aidev/charter.md` のゴールに **「DDS（DSPF/PRTF）の視覚的編集」**を足し、既にマージ済みのプレビュー・lint も含めて実態に合わせる（依存: なし）
      対象: `.gitignore`・`.aidev/charter.md:10` 付近（ゴール節） / 根拠: requirement「スコープ・対象」, `research.md`（`.vscode-test` の未追跡）
- [x] T13: 全体を検証する。`npm test` と **`npm run verify`**（原典突き合わせ＋roundtrip）を通し、**PRTF のテストが緑のまま**であることを確認する。加えて **単独起動ハーネスを Playwright で実操作**して AC-I1〜AC-I5 を機械的に確認する（`npm run dev:e2e`）。VSCode 側の器（`WorkspaceEdit`・undo・登録）は単体テストと F5 での手動確認が受け持つ（依存: T8, T11, T12）
      対象: `vscode-extension/package.json`（`test` / `verify`）・`docs/src/CUSTMNT.dspf`・`.vscode/launch.json` / 根拠: AC8, 本 plan「テスト方針」
