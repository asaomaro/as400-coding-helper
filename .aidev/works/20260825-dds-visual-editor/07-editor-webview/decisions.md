# 決定記録

## D1: 配置計算を `render/layout` に切り出し、ascii と model が同じ計算を通る構造にした

- 背景: design は「`render/ascii` と `render/model` は同じ配置計算を使う」としていたが、
  その保証は**散文の約束**だった。別実装のままだと、**ゴールデンが緑なのに GUI だけ桁がずれる**
  という最も気付きにくい壊れ方をしうる。
- 決定: `packages/dds-core/src/render/layout.ts` を新設し、`renderAscii` をそこ経由に組み替えた。
  `buildRenderModel` も同じ `placements()` を使う。加えて
  「model の占有セルが ASCII のグリッド上の占有と一致する」テストを置いた。
- 理由 / 代替案: 代替は「両方に同じロジックを書いてテストで突き合わせる」だが、
  **構造で共有していないものは、いずれ片方だけ直される**。
- 影響: 05 の実機ゴールデン（AC5 / AC6）が **GUI の配置の担保も兼ねる**ようになった。
  `renderAscii` の出力は 1 バイトも変えていない（既存 191 テストが通過）。

## D2: `RenderItem` に `segments` を足した（UI に文字を数えさせないため）

- 背景: DOM で描くとき、`text` だけでは桁が合わない。DBCS 定数は SO/SI が桁を消費するので、
  リテラルを開始桁にそのまま置くと **1 桁ずれる**。かといって UI 側で「これは全角か」を
  判断させると、換算が 2 か所になって spec D3 が破れる。
- 決定: `Segment = { text, cols }` を core が計算して `RenderItem.segments` に載せる
  （`cols` の合計は `widthCols`）。SO/SI は `text` が空の 1 桁の区切りになる。
  UI は `cols × セル幅` の箱に文字を流すだけ。
- 理由 / 代替案: 代替は (a) UI が 1 セルずつ span を作る（DOM が最大 1920 個・design DD1 が退けた形）、
  (b) UI が全角判定を持つ（DD3 違反）。**区切りを core が決める**のが、
  DOM の数を抑えつつ判断を 1 か所に保つ唯一の形だった。
- 影響: design の `RenderItem` 型への**追加**（既存フィールドは変更なし）。
  フォントが全角を 2 セル幅で描かない環境でも、**桁は箱で決まるのでずれない**
  （字が欠けることはある。CSS で `overflow: hidden`。桁の正しさを優先した）。

## D3: `RenderDiagnostic` に `code` を足し、診断はアクティブ様式で絞らない

- 背景: design の `RenderDiagnostic` は `severity` / `message` / `itemId` / `sourceLine` のみ。
  これだと UI は「隣接違反（警告・実機もコンパイルは通る）」と「桁溢れ（エラー）」を
  種類で出し分けられない。
- 決定: `code`（`DDS7103` 等）を載せた。また `buildRenderModel` は**文書全体の診断**を返す
  （表示中の様式のぶんだけに絞らない）。
- 理由: 判断は core に残したまま、**表示の区別に必要な識別子だけ**を渡す形。
  絞り込みは「GUI で開いている限り他様式の問題が見えない」状態を作るので採らなかった。
- 影響: UI は `itemId` でキャンバス上のマークと一覧を出し分けられる。

## D4: 画面サイズは既定 24×80。`DSPSIZ` は読んでいない（隠さず記録する）

- 背景: `RenderModel.canvas` の大きさをモデルから求めたいが、`DSPSIZ` はファイルレベルの
  キーワードで、03 の設計により **`opaque` 行として素通し**している（解釈していない）。
- 決定: 既定 24×80（`DEFAULT_SCREEN`）とし、`buildRenderModel` のオプションで上書き可能にした。
- 理由: キーワード解釈は L3（後続 work）の範囲。ここで `DSPSIZ` だけ特別扱いすると、
  「キーワードは未解釈で保持する」という walking skeleton の原則に穴が開く。
- 影響: **`*DS4`（27×132）の DSPF は 24×80 のキャンバスで描かれる。**
  実害が出るのはキャンバス外に置かれた要素で、その場合は `DDS7104`（エラー）が出るので
  黙って消えることはない。L3 で `DSPSIZ` を解釈するときに解消する。

## D5: 定数テキストのその場編集は実装しない（対応する `PatchOp` が無い）

- 背景: design の状態遷移図は `Editing`（定数をダブルクリック → IME 確定 → patch）を含むが、
  `PatchOp` は `moveItem` / `resizeItem` / `addItem` / `removeItem` の 4 種で、
  **既存アイテムのテキストを変える操作が無い**（plan R2 で判明）。
- 決定: skeleton では実装しない。定数の文字列は「追加」時にツールバーの入力欄で与える。
- 理由 / 代替案: (b) `removeItem` + `addItem` の対は、04 の設計で **ID が振り直され**行位置も動くため
  「テキストを直しただけ」に見えない。(c) 操作を足すのは **L2（基本属性の編集）＝requirement 対象外**。
  06 の `init` は「足場作り」で L1 の操作集合を広げなかったが、テキスト編集は明確に L2 側にある。
- 影響: **AC1 は移動で満たされる**ので完了条件に影響はない。L2 の work へ申し送る
  （そこで `setItemText` 相当を足すか、属性編集パネルとして設計するかを決める）。

## D6: WebView 側のコードは本体 tsconfig から外し、専用 tsconfig で型検査する

- 背景: WebView のコードは DOM の型を要る一方、拡張ホスト側の tsconfig は `lib: ["ESNext"]`。
  同じ設定で見ると落ちる。逆に本体の `lib` に DOM を足すと、**拡張ホスト側でも DOM が
  型として通ってしまう**（Node で動くコードなので実行時に落ちる）。
- 決定: `tsconfig.webview.json` を新設し、`lib: DOM` ＋ **`types: []`**（node / vscode / mocha を
  持ち込まない）で検査する。本体 `tsconfig.json` と `tsconfig.test.json` の双方から
  `ui.ts` / `bridge.ts` / `main.ts` を除外し、`npm run build` に `typecheck:webview` を挟んだ。
- 理由: `types: []` により、**WebView から `vscode` を import すると型解決に失敗する**——
  AC9 でコアに使ったのと同じ「境界を型システムに守らせる」手口をそのまま適用した。
- 影響: `tsconfig.test.json` の `exclude` は継承されず上書きなので、**同じ除外を二重に書く**必要がある
  （片方だけ直すと `npm test` が落ちる。実際に一度踏んだ）。

## D7: WebView 資産は `dist/webview/` へ出す（`.vscodeignore` の罠・plan R1）

- 背景: `.vscodeignore` が `src/**` と `**/*.ts` を落とすため、design が示す `src/dds/webview/*` に
  資産を置いたままだと**開発機では動くのに VSIX では真っ白**になる。
- 決定: esbuild に WebView 用のエントリを足し、`dist/webview/main.js` と `main.css` を出す
  （CSS はエントリからの `import` で esbuild が分離出力する）。`localResourceRoots` はそこだけ。
- 理由: `.vscodeignore` を緩めて `src` を同梱する案もあるが、TypeScript のソースを VSIX に入れる
  ことになり、バンドルした意味が薄れる。
- 影響: `vsce ls --no-dependencies` で `dist/webview/main.js` / `main.css` の同梱を確認済み。
  本番バンドル（`--production`）と VSIX 生成も確認した（125 files / 219.78 KB）。

## D8: `applied` はホストの変更イベントからだけ送る（経路を 1 本に保つ）

- 背景: パッチ適用後の再描画を「`applyOps` の直後に送る」ことも「`onDidChangeTextDocument` で送る」
  こともできる。両方やると二重に届き、片方だけだとテキスト側の編集を拾えない。
- 決定: **変更イベントからだけ送る**。テキストエディタ側の編集も GUI の編集も同じ道を通る。
  例外は「適用しても文書が変わらなかった場合」——変更イベントが起きないので直接返す
  （返さないと WebView が `Pending` のまま固まる）。
- 理由: spec D5 の「双方向同期は VSCode に成立させる。別経路を作らない」を実装で守るため。
  再描画はモデルを丸ごと差し替えるだけで**冪等**なので、再入してもループしない。
- 影響: `rejected` だけは変更イベントが起きないので provider から直接送る。

## D9: WebView の CSP に `unsafe-inline` を入れず、位置は必ず CSSOM で与える

- 背景: ルーラーと行番号を `innerHTML` の `style="left: …"` で組み立てていた。
  この WebView の CSP は `style-src ${cspSource}`（`unsafe-inline` なし）なので、
  **HTML の `style` 属性は落ちる**。しかも例外は出ず、**桁だけが静かにずれる**。
- 決定: `createElement` ＋ `element.style.*`（CSSOM）に書き換えた。CSSOM への代入は CSP の対象外。
  既存のプロンプター WebView は `style-src … 'unsafe-inline'` を使っているが、そちらに合わせなかった。
- 理由: この道具の価値は「桁が正しく見える」ことにあり、**桁の指定を CSP で落ちうる経路に置かない**。
  `unsafe-inline` を足すより、組み立ての流儀を 1 つに揃えるほうが再発しない。
- 影響: `ui.ts` に `innerHTML` は骨格の 1 か所しか残っていない（`style` 属性を含まない）。

## D10: 拡張の統合テストはこの環境では信頼できない（できなかったことの記録）

- 背景: T14 の手動確認の代わりに、`npm run test:integration`（`@vscode/test-electron`）で
  自動確認できないかを試した。
- 観測（2 回実行）:
  1. 1 回目: VSCode 1.134.0 が起動し、単体・`Sample Integration` までは走った。
     **`F4 Prompter Integration` で停止**——このテストは `await executeCommand("rpgClSupport.showPrompter")`
     しており、`showPrompter` は `await openPrompter(...)`（`src/extension/commands/showPrompter.ts:104`）で
     **利用者が送信／取消するまで解決しない Promise** を待つ。テストからは永久に返らない。
     **本 work の変更とは無関係の既往**（このテストは CI に載っていないため気付かれていない）。
  2. 2 回目: 拡張ホストが読み込み直後（約 0.6 秒）に終了し、テスト出力が 1 行も出ずに失敗。
     WSLg + GPU エラー（`ContextResult::kTransientFailure`）が出ており、環境側の不安定さと見られる。
- 決定: 統合テストでの自動確認は**行わない**。代わりに
  **provider が通る経路（parse → applyOps → `lineReplacement` → 範囲置換）を単体テストで固定**した
  （`test/unit/ddsEditorEdit.test.ts` の「ドラッグ移動が文書に届くまで」）。VSCode API に触るのは
  最後の `WorkspaceEdit` だけなので、そこ以外は CI で守れる。
- 影響: **GUI 上のドラッグ操作そのものは人の目で確認する必要が残る**（T14 / 親の統合 test）。
  `F4 Prompter Integration` の既往は、**親の統合 test を回す前に直す必要がある**
  （直さないと統合テスト全体がそこで止まる）。本 subtask では直していない——
  プロンプターは 07 の scope 外で、ここで直すと変更の理由が混ざるため。

## D11: 単独起動の**検証用ハーネス**を作った（製品のスタンドアロンホストではない）

- 背景: plan では「スタンドアロンホストは作らない。継ぎ目（`Host` 型と bridge）だけ作る」としていた。
  だが**継ぎ目が本当に継ぎ目になっているか**は、UI を VSCode の外で動かしてみないと分からない。
  ユーザーからも単独起動での検証の要望があった。
- 決定: `vscode-extension/dev/`（`.vscodeignore` で **VSIX から除外**）に検証用ハーネスを置いた。
  - `Bridge` の別実装（`postMessage` ではなく**直接呼び出し**）を与えるだけで、
    **`ui.ts` も `protocol.ts` も 1 行も変えずに**ブラウザで動く。
  - ホストが肩代わりしないもの（`providesFileIO: false` / `providesUndo: false`）は、
    ハーネス側の帯（ファイルを開く・保存・元に戻す）として自前で持つ——DD8 の主張の実物。
  - 対応するソースを横に出し、**読み込み時から変わった行に印**を付ける
    （「変更行 1 行（他の N 行はバイト不変）」＝ AC2 をその場で目視できる）。
- 理由: 製品のスタンドアロンホスト（ゴール範囲）を作るのではなく、**継ぎ目の検証手段**に留めた。
  ファイル操作は `<input type="file">` とダウンロードで、実運用の保存経路ではない。
- 影響: `npm run dev:standalone` でビルドし、`dev/out/` を静的配信すれば動く。
  ヘッドレス Chromium で描画を確認済み（キャンバス・ルーラー・DBCS の桁・診断・ソース面）。
  **VSIX には入らない**（`vsce ls` で確認する対象に `dev/` が出ないこと）。

## D12: フィクスチャ `dbcs-const.dspf` 自体が実機では通らない（発見・未修正）

- 背景: ハーネスで開いたところ、`EMPMNT#4`（`EMPNO 6S B`）と `EMPMNT#8`（`DEPTCD 3S B`）に
  **`DDS7108`（数値キーボードシフトなのに小数桁が空白＝エラー）** が出た。
  06 の `decisions.md` D3 が同種の不正を検出して直しているが、**このフィクスチャは直っていない**。
- 決定: **本 subtask では直さない**。05 が作ったフィクスチャで、07 の scope 外。
- 理由: 直すとバイト内容が変わり、02/03 のエンコーディング・往復テストの材料が動く。
  変更の理由が混ざるのを避ける。
- 影響: 実害は「実機に持っていくと `CPD7408` で落ちる材料をテストに使っている」こと。
  親の統合 test か、05 への差し戻しで直す判断が要る。**36-37 桁に `0` を入れるだけ**で解消する。

## D13: Playwright で GUI を実操作して検証した（19 項目・全通過）

- 背景: plan の T14 は「手動確認」としていたが、単独起動ハーネス（D11）が動くなら
  **ブラウザを実際に操作して自動で確かめられる**。手動確認は再現性が無く、回帰も拾えない。
- 実施: `playwright-core`（リポジトリ外に導入）＋ キャッシュ済み Chromium で
  ハーネスを操作した。確かめたこと:
  - セル幅の実測（`7.00×14.00px`）と、**DBCS 定数の箱が `widthCols`（SO/SI 込み 10 桁）どおり**・
    左端が `pos` どおりであること（D2 の「1 桁ずれ」が起きていないことの実測）。
  - **ドラッグ移動 → 39-41 / 42-44 桁だけが更新**され、38 桁目までと 45 桁目以降が不変（**AC1**）。
  - **変わった行は 1 行だけ**・行数不変（**AC2**）。コメント・継続行を含む `messy.dspf` でも同じ（**AC3**）。
  - リサイズ → 30-34 桁が変わる。追加 → 行が 1 本増え、クリックした桁（`20 30`）に入る。
    Delete → その行だけ消える。**L1 の 4 操作すべてが GUI から効く**（requirement 機能要件 6）。
  - ホスト側 undo（DD8 の「自前で持つ」側）で元のテキストに戻る。
  - 実行中に JS エラーが出ない。
- 影響: **GUI の正しさが機械的に確かめられる**状態になった。VSCode 側でしか確かめられないのは
  AC8（既定エディタ・ルーラー / SOSI）と `WorkspaceEdit` の適用だけに絞られた。

## D14: 「元からエラーのある項目は移動できない」（04 の挙動・要判断）

- 背景: e2e の 1 回目で、`EMPMNT#4`（`EMPNO 6S B`・小数桁なし＝`DDS7108`）を掴んで動かしても
  **何も起きなかった**。原因は `applyOps` が「**触った行にエラーがあれば拒否**」する規則
  （`patch/ops.ts`）。この項目は**元からエラーを持つ**ため、移動しただけで拒否される。
- 観測: GUI は拒否理由（「この操作はエラー級の違反を生みます（適用していません）」）を
  状態表示に出しており、**黙って無視はしていない**（e2e で固定した）。
- 論点: spec は「**検証違反を生む**パッチは適用前に拒否」と書いている。移動は違反を**生んで**いない。
  現行規則だと「レイアウトを直そうとビジュアルエディタを開いたのに、直したい項目が凍っている」
  という状況が起きうる。**「新たに増えたエラーだけで拒否する」**（適用前後の差分で判断）が
  spec の文面に近い。
- 決定: **07 では変えない**（`patch/ops.ts` は 04 の成果物で、判定規則の変更は影響が広い）。
  本記録で明示し、判断をユーザー／親の統合レビューに委ねる。

## D15: ユーザー判断で 3 件を本 subtask 中に実施した（2026-08-26）

D12 / D14 と e2e の扱いについてユーザーに諮り、次のとおり決めた。

1. **D14（元からエラーのある項目が動かせない）→ 04 へ差し戻して直した。**
   `04-validate-patch` を coding へ戻し（`approved` から test / review を除去）、
   `applyOps` の拒否規則を「**増えたエラーだけ拒否**」に変更（04 `decisions.md` D6・回帰テスト 4 本）。
2. **D12（フィクスチャが実機で `CPD7408` になる）→ 今直した。**
   `dbcs-const.dspf` と `dbcs-const.sjis.dspf` の 36-37 桁に `0`（UTF-8 / Shift_JIS の**両方**）。
   `dds validate` が「問題なし」を返すことと、AC10 の同一モデル性を確認。
3. **e2e はリポジトリに残す（手動導入）。** `vscode-extension/dev/e2e.mjs` ＋ `dev/README.md`。
   `playwright-core` は **devDependency にしない**——CI ではブラウザ本体が無く動かせず、
   入れると「CI に載っているのに走っていないテスト」が生まれるため。
   `npm run dev:e2e` はブラウザ未検出なら理由を出して exit 2 する（黙って緑にしない）。

**e2e 21 件すべて合格**（規則変更の回帰 2 件を含む）。全体 verify も通過。

## D16: T14 の GUI 確認は自動化した。VSCode 側だけが人の目に残る

- 背景: plan の T14 は「手動確認」だったが、単独起動ハーネス＋Playwright で
  **ドラッグ移動・リサイズ・追加・削除・拒否経路・DBCS の桁**まで機械で確かめられた（D13）。
- 決定: T14 は「**スタンドアロンで自動確認済み／AC8 は親の統合 test へ申し送り**」として閉じる。
- 残るもの（VSCode でしか見られない）:
  - **AC8**: `.dspf` をダブルクリックしたときテキストエディタが開き、ルーラー / SOSI が従来どおり動く。
  - `CustomTextEditorProvider` の `WorkspaceEdit` 適用（単体では `parse → applyOps → lineReplacement` まで固定済み）。
  - F5 用の `.vscode/launch.json` は用意してある（`.gitignore` 済み）。

## D17: review ラウンド 1 の指摘に対応した（must 1 / should 2 / nit 2）

- **must-1（削除で行が複製される）**: `lineReplacement` に**旧テキストも渡す**ようにし、
  旧文書側の終端を `新終端 + (旧行数 - 新行数)` で求める形にした。
  `applyOps` の `changedLines` が**適用後テキストの座標**であることを、型と関数名の両方で明示する。
  provider 側は挿入 / 削除 / 置換の 3 形に分岐（`applyLineReplacement`）。
  **末尾に改行が無い文書への追記**は `Position(lineCount, 0)` が範囲外になるので、
  最後の行の行末に `改行 + 本文` を差し込む形にした。
  - 再発防止: **4 操作すべて**で「provider の置換結果 ＝ `applyOps` の `text`」を突き合わせるテストを追加。
    見逃した原因は、単体テストが移動しか通しておらず、e2e 側（スタンドアロン）は
    `result.text` をそのまま採るため `lineReplacement` を経由しなかったこと——
    **2 つの検証手段が揃って同じ穴を持っていた**。
- **should-1（例外で WebView が固まる）**: `PatchRejectedError` 以外の例外も捕まえて
  `rejected` を返すようにした。**返事をしないことが最悪**——UI は `Pending` から戻れない。
- **should-2（構造変更後の選択が別アイテムを指す）**: `addItem` / `removeItem` の適用後は選択を解除する。
  送信したパッチを `pendingOp` に覚えておき、構造変更かどうかで判定する。
- **nit-1**: `RenderItem.sourceLine` は design の型に無い追加（`openSource` に必要）。
  `segments`（D2）・`code`（D3）と同じく**追加**であり、既存フィールドは変えていない。
- **nit-2**: `dds/model.ts` の「削除しても他のアイテムの番号を詰めない」は**実挙動と逆**だった
  （再パースで詰まる）。**この記述を信じて UI を書いて should-2 の罠にはまった**ので、
  コメントを実挙動に合わせ、「ID を保持する側が構造変更後に捨てる責任を持つ」ことを明記した。

再検証: core 218 / CLI 37 / 拡張 52（+5）すべて合格、e2e 21/21 合格、`guard:no-vscode` OK。

## D18: WebView プロトコルのフィールド名は `model`（spec の記述との差分）

- 背景: `spec.md`「WebView プロトコル」は `{type:"load", doc: RenderModel}` と書いているが、
  実装は `model` にしてある。加えて `load` に `host`（DD8 の能力宣言）を同梱し、`rejected` を足した。
- 決定: **実装は `model` のままとする。** `doc` は core で `DdsDoc` を指す語なので、
  `RenderModel` に使うと 2 つの型が同じ名前で行き来することになる。
  design のシーケンス図も `model` なので、**design と実装は一致**しており、差分は spec の記述だけ。
- 影響: spec 本文は承認済み成果物なので書き換えない。**この記録が差分の所在**になる。
  後続 work で spec を更新する機会があれば揃える。
