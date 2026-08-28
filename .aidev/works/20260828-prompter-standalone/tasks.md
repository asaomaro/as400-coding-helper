# タスク: F4 プロンプターを VSCode 非依存に作り替える

- [x] T1: `ObjectKind` / `ObjectCandidates` を純粋な `types.ts` へ移し、`workspaceObjects.ts` は再輸出にする
      対象: `vscode-extension/src/prompter/types.ts` `vscode-extension/src/prompter/workspaceObjects.ts:18` / 根拠: research F1
- [x] T2: `applyChanges.ts` の純粋部分を `commandText.ts` へ切り出し、`applyChanges.ts` から再輸出する
      対象: `vscode-extension/src/prompter/applyChanges.ts:88-500` / 根拠: research F5, A5
- [x] T3: `buildInitialState` に `InitialStateOptions`（`occurrences` / `reportEmptyRequired`）を足す（既定は不変）
      対象: `vscode-extension/src/prompter/model.ts:88` `:115` / 根拠: spec「2.」
- [x] T4: `toSerializableState` と `Serializable*` 型を `formModel.ts` へ移し、`positionLine/Column` を落とす（依存: T1）
      対象: `vscode-extension/src/prompter/binding.ts:18-240` / 根拠: research F5-1, A2
- [x] T5: `webview/protocol.ts`（契約・`PrompterHost`・`parsePrompterMessage`）と `webview/bridge.ts` を作る（依存: T4）
      対象: `vscode-extension/src/prompter/webview/` （新規） / 根拠: research F6, A6
- [x] T6: `webview/ui.ts` / `ui.css` / `main.ts` を作る（描画・再評価・確定・キー操作）（依存: T3, T4, T5）
      対象: `vscode-extension/src/prompter/webview/ui.ts` （新規。移植元 `binding.ts:359-1284`）
- [x] T7: `webviewHtml.ts` を作り、`webview.ts` を差し替え、`binding.ts` と `help.ts` を消す（依存: T6）
      対象: `vscode-extension/src/prompter/webview.ts:52-107` / 根拠: research A3, spec「5.」
- [x] T8: `tsconfig.json` / `tsconfig.test.json` / `tsconfig.webview.json` / `esbuild.webview.mjs` を配線する（依存: T7）
      対象: `vscode-extension/tsconfig.webview.json:20` `vscode-extension/esbuild.webview.mjs:32`
- [x] T9: 単独起動ハーネス `dev/prompter.html` / `dev/prompter.css` / `dev/prompter-standalone.ts` を作る（依存: T2, T8）
      対象: `vscode-extension/dev/` （新規。参考 `dev/standalone.ts`） / 根拠: research F7, F8
- [x] T10: e2e `dev/prompter-e2e.mjs` を書き、`npm run dev:e2e` と CI の `gui-e2e` に載せる（依存: T9）
      対象: `vscode-extension/dev/prompter-e2e.mjs` （新規）, `.github/workflows/prompter-definitions.yml`
- [x] T11: `buildHtml` を見ている既存テストを、`formModel` / e2e へ移し替える（依存: T10）
      対象: `vscode-extension/test/unit/cdmlRules.test.ts:395` `:654` `:671`, `test/unit/prompterRegressions.test.ts:134` `:171`
- [x] T12: 新しいコアの引数・`parsePrompterMessage`・`maxlength` の算出に単体テストを足す（依存: T11）
      対象: `vscode-extension/test/unit/` （新規 `prompterWebview.test.ts`） / 根拠: plan R5

## 途中で足したもの（計画外）

- [x] T13: `layout()` を `formModel.ts` の `buildBlocks()` へ移す
      理由: 並び順の規則は**単体テストできる場所**に要る（`ui.ts` はブラウザ専用で `.css` を import する）。
      対象: `vscode-extension/src/prompter/formModel.ts`
- [x] T14: F5 の `preLaunchTask` を `compile:all` にする
      理由: `compile` だけでは束ねた資産が無く、**F5 起動で画面が真っ白になる**（DDS 側も同じ穴だった）。
      対象: `.vscode/tasks.json` `vscode-extension/package.json`
- [x] T15: `AGENTS.md`「プロンプターは『モデルまで』では届いていない」を書き換える
      理由: 「`String(...)` で script に埋め込む」という記述が**この変更で嘘になる**。
      対象: `AGENTS.md:273`
- [x] T16: `dev/README.md` にプロンプター側を足す
      対象: `vscode-extension/dev/README.md`
