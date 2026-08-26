# 決定記録（親 work）

subtask 側の決定は各 `<NN>-<subslug>/decisions.md` にある。ここには**統合の段で決めたこと**だけを置く。

## D1: 統合 test で F4 プロンプターの既存テストを直した（最小修正）

- 背景: 拡張の統合テストスイートが**回らなかった**。`test/integration/f4Prompter.test.ts` が
  `await vscode.commands.executeCommand("rpgClSupport.showPrompter")` しており、
  `showPrompter` は `await openPrompter(...)`（**利用者が送信／取消するまで解決しない Promise**）を待つ。
  テストからは永久に返らず、拡張ホストごと落ちる（07 `decisions.md` D10 で観測）。
- 決定: **await をやめ**、「一定時間内に reject しないこと」で「例外なく起動できる」ことだけを見る形にした。
  併せて `teardown` でエディタを閉じる。
- 理由: このテストの意図は元々「コマンドが例外を投げずに実行できる」ことの確認。
  **統合 test を回すための最小修正**に留め、プロンプターの構造には触っていない。
- 影響: 統合スイートが最後まで走るようになり、**DDS の統合テストを VSCode 上で実行できるようになった**。
  **プロンプターを VSCode 非依存（standalone 基準）に作り替え、Playwright で自律テストする**のは
  **別 work** として起こす（ユーザー判断 2026-08-26。DDS の PR に混ぜるとレビュー単位が壊れるため）。

## D2: 統合 test を VSCode 上で実行できる形にした（GUI の外側だけ機械化）

- 背景: WebView の**中**は拡張ホストから触れないので、ドラッグ操作そのものは統合テストにできない。
  一方で「文書側が正しく変わるか」は VSCode 上で機械的に確かめられる。
- 決定: `editorProvider` に `applyPatchToDocument(document, ops)` を公開し、
  **provider と同じ経路**（`parse → applyOps → lineReplacement → WorkspaceEdit`）を
  実 `TextDocument` に対して通せるようにした。統合テストはこれを使う。
  GUI 操作そのものは 07 の Playwright e2e（スタンドアロン）が担う。**二段構えで穴を塞ぐ。**
- 影響: AC1 / AC2 / AC3 / AC8 と undo が**実 VSCode 上で**確認できるようになった
  （統合 76 件合格）。残るのは「WebView 内のドラッグが VSCode 上でも同じに動くか」だけで、
  これは同じ `ui.ts` が e2e で確認済みであることをもって足りるとみなす。

## D3: 統合テストは CI に載せない（現状維持・要再検討）

- 背景: 親 plan で「VSCode の統合テストは CI に載せない（表示環境が要る）」と決めていた。
  今回この環境（WSLg）では実際に走った。GitHub Actions でも `xvfb-run` で走らせられる見込み。
- 決定: **本 work では載せない**（plan の決定を維持）。
- 理由: 実行時間（VSCode 本体 1.2GB のダウンロードとキャッシュ）と、CI の安定性の見極めが要る。
  実際この環境でも 1 回、拡張ホストが即終了して出力ゼロで落ちた（07 `decisions.md` D10）。
  **不安定なテストを CI に置くと、赤を無視する習慣がつく**——それが最も避けたい。
- 影響: **統合テストは手元でだけ回る**。deliver の PR 本文に「CI 非搭載」として明記し、
  backlog に「統合テストの CI 化（xvfb + キャッシュ）」を起票する。
