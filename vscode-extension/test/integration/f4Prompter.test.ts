import { strict as assert } from "node:assert";
import * as vscode from "vscode";

/**
 * F4 プロンプターが**例外なく起動する**ことだけを確かめる。
 *
 * ## なぜ `await` しないか
 *
 * `showPrompter` は `await openPrompter(...)` を返す——**利用者が送信／取消するまで
 * 解決しない Promise** を待つ。テストから `await executeCommand(...)` すると
 * 永久に返らず、**拡張ホストごと落ちて統合スイート全体が止まる**
 * （2026-08-26 に実測。単体と `Sample Integration` まで走ったあと停止した）。
 *
 * ここで見たいのは「開けること」であって「閉じたあとどうなるか」ではない。
 * 送信／取消の振る舞いは WebView の e2e（`dev/e2e.mjs`）が実物で確かめている。
 */

/** `promise` が `ms` の間 reject しないこと。解決を待たない。 */
async function settlesOrKeepsRunning(promise: Thenable<unknown>, ms: number): Promise<void> {
  let failure: unknown;
  void Promise.resolve(promise).then(
    () => undefined,
    (error: unknown) => {
      failure = error;
    }
  );
  await new Promise(resolve => setTimeout(resolve, ms));
  if (failure !== undefined) throw failure;
}

suite("F4 Prompter Integration", () => {
  teardown(async () => {
    // **開いたままにしない。** プロンプターの WebView も編集中のタブも閉じる。
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("F4 プロンプターが例外なく起動する（CL）", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "cl",
      content: "CALL PGM(MYPGM)"
    });

    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(
      new vscode.Position(0, 0),
      new vscode.Position(0, 0)
    );

    await settlesOrKeepsRunning(
      vscode.commands.executeCommand("rpgClSupport.showPrompter"),
      1500
    );

    assert.ok(true, "起動中に例外が出ていない");
  });

  test("定義の無い行でも例外にならない", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "cl",
      content: "/* コメントだけの行 */"
    });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(
      new vscode.Position(0, 0),
      new vscode.Position(0, 0)
    );

    await settlesOrKeepsRunning(
      vscode.commands.executeCommand("rpgClSupport.showPrompter"),
      1000
    );

    assert.ok(true, "起動中に例外が出ていない");
  });
});
