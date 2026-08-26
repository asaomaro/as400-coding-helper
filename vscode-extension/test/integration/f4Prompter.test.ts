import { strict as assert } from "node:assert";
import * as vscode from "vscode";

suite("F4 Prompter Integration", () => {
  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("F4 prompter command executes for CL document", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "cl",
      content: "CALL PGM(MYPGM)"
    });

    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(
      new vscode.Position(0, 0),
      new vscode.Position(0, 0)
    );

    // **await してはいけない。** showPrompter は WebView を開いたあと
    // `openPrompter` の Promise を待つ（src/prompter/commands 経路）。この Promise は
    // **利用者が送信／取消するまで解決しない**ので、await するとテストが永久に返らず、
    // 拡張ホストごと落ちる（統合テスト全体が止まる）。
    // ここで見たいのは「例外を投げずに起動できること」だけなので、
    // 一定時間内に reject しないことをもって合格とする。
    const running = Promise.resolve(
      vscode.commands.executeCommand("rpgClSupport.showPrompter")
    ).then(
      () => "resolved" as const,
      error => {
        throw error;
      }
    );
    const settled = await Promise.race([
      running,
      new Promise<"pending">(resolve => setTimeout(() => resolve("pending"), 1500))
    ]);

    assert.ok(
      settled === "pending" || settled === "resolved",
      "F4 prompter command executed without throwing"
    );
  });
});
