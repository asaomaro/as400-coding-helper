# レビュー: DDS ビジュアルエディタ walking skeleton（親・統合 review）

subtask 単体の review は各 `<NN>-<subslug>/review.md` にある。
ここでは **subtask 横断の結合**（契約整合・結線・統合 test の通過）を見る。

## ラウンド 1（2026-08-26）

### 規模

新規 TypeScript 約 7,400 行（`packages/dds-core` / `packages/dds-cli` / `vscode-extension/src/dds` /
`vscode-extension/dev`）、3 パッケージ構成の新設、CI ワークフロー新設、実機ゴールデン採取。
変更・新規のパスは 200 超。

### 契約整合（subtask 間）

- **表示桁の換算は 1 か所**（spec D3）: `text/encoding` が葉として存在し、
  `parse` / `serialize` / `validate` / `render` / `dbcsShiftMarkers`（02）がすべてここを通る。
  **WebView は換算を持たない**——`segments`（07 D2）で「文字と占有桁数の対応」を core が渡す形にしてある。
- **DBCS 判定の正本は 1 つ**（spec D4）: `dbcsShiftMarkers` は `@as400/dds-core` から import。
  二重定義は無い（`grep` で確認）。
- **配置計算の共有**（design）: `render/ascii` と `render/model` が `render/layout` を経由する
  （07 D1）。**05 の実機ゴールデンが GUI の配置の担保も兼ねる**ことを、
  「model の占有セル ＝ ascii のグリッド占有」テストで固定した。
- **編集の入口は 1 つ**（AC4）: CLI（06 の parity テスト）と GUI（本ラウンドで追加した統合テスト）が
  **同じ `applyOps` を通り、結果が 1 バイトも違わない**ことを両側から実証した。
- **`PatchOp` は 4 種のまま**（04・06 D1）。GUI の L1 操作と 1:1。`init` は足場作りで対象外、と記録済み。

### 結線

- `extension.ts` → `registerDdsVisualEditor`、`contributes.customEditors`（`priority: "option"`）。
  **`contributes.languages` / `grammars` は無変更**、`fileScope.ts` も無変更（AGENTS.md の波及チェック）。
- esbuild が拡張本体（Node/CJS）と WebView（browser/IIFE）を別々に束ね、**`dist/` に出す**。
  `.vscodeignore` が `src/**` を落とすため、ここを誤ると VSIX で真っ白になる（07 D7・実際に踏んだ）。
  `vsce ls` で `dist/webview/main.js` / `main.css` の同梱と、`dev/**` が入らないことを確認済み。
- CI（`extension-tests.yml`）は `npm ci` → root `build` → root `test` → `guard:no-vscode`。
  root `build` が拡張の `typecheck:webview` を含むので、**WebView 側と dev ハーネスも CI で型検査される**。

### 統合 test

**77 件合格**（VSCode 1.134.0 実機）。AC1 / AC2 / AC3 / AC4（GUI 側）/ AC8 と undo を実文書で確認。
詳細は `decisions.md` D1・D2。

### 指摘

#### nit-1: spec の WebView プロトコルと実装でフィールド名が違う（記録が無い）

`spec.md`「WebView プロトコル」は `{type:"load", doc: RenderModel}` だが、実装は `model`
（加えて `host` を同梱し、`rejected` を追加）。**design のシーケンス図は `model`** なので
design と実装は一致しており、齟齬は spec の記述だけ。`doc` は core の `DdsDoc` を指す語で、
`RenderModel` に使うと紛らわしい——**実装（`model`）が正しい**。

→ 07 `decisions.md` に「spec の記述との差分」として記録する（spec 本文は承認済み成果物なので書き換えない）。

#### nit-2: `createNonce` が 2 か所にある

`src/prompter/webview.ts` と `src/dds/webviewHtml.ts`。10 行ほどの重複。
**次の work（プロンプターの standalone 化）がこのファイルを作り替える**ので、そこで共通化するのが自然。
いま動かすと、次の work の差分と衝突する。

→ 次 work へ申し送り（本 work では直さない）。

### 未検証（deliver の PR 本文へ）

- **統合テストは CI 非搭載**（`decisions.md` D3）。手元でのみ実行。
- **条件標識付きの要素同士の重なり**（`CPD7866` の文言からは未警告と推測。標識対応は後続 work）。
- **PRTF** は本 work の対象外（実機に資産が無く、フィクスチャは完全に自作になる）。
- **`ruler.ts` の DBCS 桁ズレ**（research F10）は本 work では直さない方針。02 で実測し起票済み。

### 判定

**must 0 件 / should 0 件 / nit 2 件**（いずれも記録・申し送りで解消）。**統合 review 通過**。

### walkthrough（任意工程）の推奨

protocol「4.5」の検知条件に**3 つとも該当**する:

- **差分が大きい**（新規 7,400 行超・200 超のパス）
- **複数モジュール横断**（3 パッケージ ＋ WebView ＋ CI ＋ ゴールデン採取手順）
- **処理フローが複雑**（GUI → patch → core → WorkspaceEdit → 再描画の往復、
  スタンドアロン / VSCode の 2 ホスト、実機ゴールデンとの突き合わせ）

**人間の PR レビューには解説が要る規模**なので、deliver の前に walkthrough を挟むことを推奨する。
