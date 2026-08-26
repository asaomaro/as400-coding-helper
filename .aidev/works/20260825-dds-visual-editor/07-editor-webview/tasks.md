# タスク: 07-editor-webview

- [x] T1: 配置計算（アイテム → 画面上の占有セル）を共有モジュールへ切り出し、`renderAscii` をそれ経由に組み替える。**ascii の出力は 1 バイトも変えない**（05 のゴールデンが回帰検知になる）
      対象: `packages/dds-core/src/render/ascii.ts:83`（`placedItems`）`:98`（`draw`）→ `packages/dds-core/src/render/layout.ts`（新規） / 根拠: design「同じ配置計算を GUI も使う」, 本 plan「05 のゴールデンを 07 の配置の担保にする」
- [x] T2: `buildRenderModel(doc, options)` を実装する。`RenderModel` / `RenderRecord` / `RenderItem` / `RenderDiagnostic` を design の型どおりに定義し、**DD5 の拡張点（`kind` / `lineMode` / `records` 配列 / `activeRecordId` / `editable`）を今から型に刻む**。`widthCols` は core が計算し（DD3）、**描画幅は `itemContentWidth`**（符号位置は画面上で空白＝06 の `decisions.md` D4）。`text` は ascii と同じプレースホルダ規約（英数字 `X` / 数値 `9` / 定数はリテラル）（依存: T1）
      対象: `packages/dds-core/src/render/model.ts`（新規） / 参照: `packages/dds-core/src/dds/validate.ts:94`（`itemContentWidth`）`:122`（`signPositions`） / 根拠: design「RenderModel」DD3・DD5
- [x] T3: `canvas` と `diagnostics` の載せ方を決めて実装する。**`DSPSIZ` は `opaque` 行のため画面サイズを解釈できない**ので既定 24×80（`DEFAULT_SCREEN`）＋オプション上書きとし、「読めていない」ことを `decisions.md` に明記する。`diagnostics` は `validate` の結果を `sourceLine` ごと写す（依存: T2）
      対象: `packages/dds-core/src/render/model.ts` / 参照: `packages/dds-core/src/dds/validate.ts:176`（`validate`）`:66`（`DEFAULT_SCREEN`） / 根拠: 本 plan R5
- [x] T4: `index.ts` へ公開 API を追加し、コアのユニットテストを書く。配置・`widthCols`・DBCS ケース・拡張点の既定値・`diagnostics`。**加えて「model の占有セル範囲が `renderAscii` のグリッド上の占有と一致する」テスト**を置き、配置計算の共有を証明する（依存: T2, T3）
      対象: `packages/dds-core/src/index.ts:92`（`renderAscii` の export 隣）・`packages/dds-core/test/renderModel.test.ts`（新規） / 根拠: 親 plan「テスト方針」の `07` 行
- [x] T5: WebView の契約を 1 ファイルに定義する。host→webview（`load` / `applied` / `rejected`）、webview→host（`ready` / `patch`）と、DD8 の `Host` 型（`providesFileIO` / `providesUndo` / `providesCommandPalette` / `canOpenTextEditor` / `hasPrompter`）。**`vscode` にも `dds-core` の実装にも依存させない**（スタンドアロンホストが同じ型を使えるように）
      対象: `vscode-extension/src/dds/webview/protocol.ts`（新規） / 根拠: spec「WebView プロトコル」, design DD8
- [x] T6: `bridge.ts` を書く。**`acquireVsCodeApi` の呼び出しはここだけ**。UI とはプレーン関数で会話し、VSCode ホストの `Host` 値（`providesFileIO`/`providesUndo`/`providesCommandPalette` = `true`）を組み立てる。ここを崩すと後で全面書き直しになる（親 plan R4）（依存: T5）
      対象: `vscode-extension/src/dds/webview/bridge.ts`（新規） / 根拠: design「vscode-extension」表, 親 plan R4
- [x] T7: キャンバスを描く。**DOM 絶対配置**（アイテム 1 件 = 要素 1 個。セル単位の要素は作らない）、グリッド / ルーラーは CSS background、**セル幅は起動時に実測して `--cell-w` に入れる（`ch` を使わない・DD2）**。幅の確保は `widthCols`・文字はリテラルを素で流す（本 plan R6）。**測定値をデバッグ表示に出す**（親 plan R6）（依存: T5, T6）
      対象: `vscode-extension/src/dds/webview/ui.ts`（新規）・`vscode-extension/src/dds/webview/ui.css`（新規） / 根拠: design DD1・DD2・DD3
- [x] T8: 選択とドラッグ移動を実装する（**AC1 の主経路**）。状態遷移は `Idle → Selecting → Dragging → Pending → Idle`。**楽観更新をしない**（core の判定が唯一の正）——ドラッグ中の見た目だけ追従させ、確定は `applied` の往復後。`rejected` なら元位置へ戻す。px → セルは線形変換のみ（依存: T7）
      対象: `vscode-extension/src/dds/webview/ui.ts` / 根拠: design「WebView の状態遷移」, requirement AC1
- [x] T9: 残る L1 3 操作を GUI に載せる。リサイズハンドル → `resizeItem` / 追加 → `addItem` / Delete キー → `removeItem`。**GUI 独自の編集経路を作らない**（4 つの `PatchOp` に 1:1）。定数テキストの編集は**実装しない**（本 plan R2）（依存: T8）
      対象: `vscode-extension/src/dds/webview/ui.ts` / 参照: `packages/dds-core/src/patch/ops.ts:52-80`（`PatchOp` 4 種） / 根拠: requirement 機能要件 6・AC4, 本 plan「最小 GUI の線引き」
- [x] T10: `CustomTextEditorProvider` を実装する。**仲介のみでロジックを置かない**（DD6）。`patch` 受信 → `applyOps` → **`changedLines` の範囲だけ `WorkspaceEdit`** → `onDidChangeTextDocument` → `parse` → `buildRenderModel` → `applied`。`PatchRejectedError` は `rejected` として返す。不正メッセージは無視してログに残す。**自分の編集の再入でループさせない**（本 plan R4）（依存: T4, T5）
      対象: `vscode-extension/src/dds/editorProvider.ts`（新規） / 参照: `packages/dds-core/src/patch/ops.ts:150`（`applyOps`）`:104`（`ChangedLines`）・`vscode-extension/src/prompter/webview.ts:29,39`（WebView の作法・nonce） / 根拠: design DD6, spec「編集 → 書き戻しの流れ」
- [x] T11: 登録と有効化。`contributes.customEditors`（`viewType` / `filenamePattern: "*.dspf"` / **`priority: "option"`**）を追加し、`extension.ts` で provider を登録する。**`contributes.languages` と `grammars` は触らない**（依存: T10）
      対象: `vscode-extension/package.json:15`（`activationEvents`）`:21`（`contributes`）・`vscode-extension/src/extension/extension.ts:6` / 根拠: research F11・「実装時の注意」, AGENTS.md「languageId 変更時の下流波及チェック」, requirement AC8
- [x] T12: WebView 資産が VSIX に載る経路を作る。**`.vscodeignore` が `src/**` と `**/*.ts` を落とす**ため、素直に置くと開発機では動くのに VSIX では真っ白になる。esbuild に webview エントリを足して `dist/webview/` へ出し、`localResourceRoots` をそこへ向ける。CSP / nonce は既存の作法に倣う。**`npm run bundle -- --production` と VSIX 生成まで確認する**（依存: T7, T10）
      対象: `vscode-extension/esbuild.mjs:12`（`entryPoints`）・`vscode-extension/.vscodeignore`・`build-vsix.sh` / 根拠: 本 plan R1, 親 plan R5
- [x] T13: 拡張側のテストを書く。**`vscode` に触らない純関数を切り出して単体化する**（統合テストは CI に載らないため・本 plan R8）: メッセージの型検証（不正を弾いて例外を投げない）・`changedLines` → 置換範囲の写像（**全文置換にならない**こと）・px ⇄ セルの座標変換（依存: T10, T12）
      対象: `vscode-extension/test/unit/ddsEditorProtocol.test.ts`（新規）・`vscode-extension/test/unit/ddsEditorEdit.test.ts`（新規） / 根拠: 親 plan「CI に載せるもの / 載せないもの」, 本 plan R8
- [x] T14: 手動確認と **AC8 の非後退確認**。`.dspf` をダブルクリック → **テキストエディタが開く**・ルーラー / SOSI が従来どおり動く・「エディタで開く」から GUI が開ける・ドラッグ移動 → 保存で 39-44 桁が更新される。**表示環境が無く実施できない場合は、できなかったことを記録して親の統合 test へ申し送る**（取り繕わない）（依存: T11, T12）
      対象: `packages/dds-core/test/fixtures/*.dspf`（既存フィクスチャを使う）・`.aidev/works/20260825-dds-visual-editor/07-editor-webview/decisions.md` / 根拠: requirement AC8・AC1, 親 plan「親の統合 test」
