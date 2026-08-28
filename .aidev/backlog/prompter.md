---
backlog: prompter
kind: standing        # standing（定常ドメインキュー）| split（タスク分割由来・短命）
priority: 1           # 既存機能の構造改善。DDS(1) と同格
---
# F4 プロンプター バックログ

`vscode-extension/src/prompter/` と `src/extension/commands/showPrompter.ts` に関するキュー。

`aidev-util-batch` が消化する対象リスト。各未チェック行 = 1件のタスク。

## 項目

- [ ] **F4 プロンプターを VSCode 非依存（standalone 基準）に作り替え、Playwright で自律テストできるようにする**

  **狙い**: DDS ビジュアルエディタ（`20260826-dds-editor-port` / PR #109）で確立した構造
  ——判断はコア / UI は描くだけ / `acquireVsCodeApi` は bridge の 1 か所 / ホスト能力を宣言——
  をプロンプターにも適用し、**VSCode の外で動かして自動でテストできる**状態にする。

  **現状（2026-08-27 実測・現 main）**:
  - `src/prompter/` は **4,718 行 / 17 ファイル、うち 9 ファイルが `vscode` を import**。
  - UI は `binding.ts`（**1,401 行**）が HTML + CSS + インラインスクリプトを**文字列で組み立てる**。
    状態は WebView 内に持ち、確定時にまとめて受け取る作り。
  - 次に大きいのは `applyChanges.ts`(498) / `cdmlRules.ts`(394) / `clCommandParser.ts`(392) /
    `model.ts`(382) / `types.ts`(307)。**桁の書き戻しと検証はコア側に寄っており、再利用できる**。

  **参考にする実装**（PR #109 で動いているもの）:
  - `src/dds/webview/protocol.ts` — メッセージ契約 ＋ ホストが何を肩代わりするかの宣言
  - `src/dds/webview/bridge.ts` — `acquireVsCodeApi` の唯一の呼び出し箇所
  - `src/dds/webview/ui.ts` / `geometry.ts` — 素の web の UI と、純関数の座標計算
  - `dev/standalone.ts` / `dev/e2e.mjs` — 単独起動ハーネスと実操作 e2e（15 件）
  - `tsconfig.webview.json` — `types: []` で **WebView から `vscode` を型ごと締め出す**
  - `esbuild.webview.mjs` — WebView だけを束ねる（拡張ホストは tsc のまま）

  **規模の見立て**: DDS エディタ（新規 12 ファイル・約 4,000 行）と同等かそれ以上。
  **単独の work として起こす**（他の変更に混ぜるとレビュー単位が壊れる）。

  **非後退で守るもの**: F4 の起動経路（キーバインド・`resourceExtname` の条件）、
  定義 JSON の読み込み、可変パラメータ・グルーピング・ヘルプ（F1）、
  `applyChanges` の桁書き戻し、CL 往復検証（`npm run verify` の `verify:roundtrip`）。

  出所: ユーザー要望（2026-08-26）。

- [x] **F4 の統合テストが止まる問題を直す** — 済（`20260828-f4-integration-test`）。
  待つのをやめ、「一定時間 reject しないこと」で**起動できること**だけを見る。
  送信／取消の振る舞いは WebView の e2e が実物で確かめている。
  - **起票より壊れている範囲が広かった。** `await` を直しても走らない状態だった:
    `vscode-test` が**依存に入っておらず**、`test/suite/index.ts` は `bdd` で
    `suite` / `test` を拾えず、対象も 1 つ上（**単体テストまで拡張ホストで走る**）を
    見ており、走らせる npm スクリプトも無かった。器ごと直した。
  - **`mocha` に時間切れ（20 秒）を持たせた。** 次に誰かが `await` を書いても、
    その 1 本が落ちるだけで**スイートごとは死なない**。戻して確かめ済み——
    止まる形は 20 秒で落ち、他の 1 本は通った。
  - `npm run test:integration` で走る（手元で 3 passing / 終了コード 0）。
    CI にも `integration` ジョブとして載せた（Electron を動かすので `xvfb-run`）。
  - **いま確かめているのは「例外なく起動できる」まで**。`WorkspaceEdit` や undo は
    まだ書いていないが、**器が動くようになったので次から足せる**。

