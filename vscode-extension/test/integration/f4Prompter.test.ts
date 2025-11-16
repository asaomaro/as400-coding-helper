import { strict as assert } from "node:assert";
import * as vscode from "vscode";

suite("F4 Prompter Integration", () => {
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

    await vscode.commands.executeCommand("rpgClSupport.showPrompter");

    assert.ok(true, "F4 prompter command executed without throwing");
  });
});

