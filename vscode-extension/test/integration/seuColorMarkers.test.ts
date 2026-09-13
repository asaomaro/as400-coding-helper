import { strict as assert } from "node:assert";
import * as vscode from "vscode";

const extensionId = "as400-coding-helper.rpg-cl-vscode-support";

suite("SEU 色 marker Integration", () => {
  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("色 marker と SOSI を同じ対象文書で有効にしても本文を変更しない", async () => {
    const extension = vscode.extensions.getExtension(extensionId);
    assert.ok(extension, "拡張機能が extension host に読み込まれている");
    await extension.activate();

    const text = "Ŕ顧客ŶABC";
    const document = await vscode.workspace.openTextDocument({
      language: "rpg-fixed",
      content: text
    });
    await vscode.window.showTextDocument(document);

    // SOSI と色 marker は別の decoration type として登録される。SOSI command を
    // 往復しても、色 marker を含む保存本文を装飾のために書き換えないことを確認する。
    await vscode.commands.executeCommand("rpgClSupport.sosi.toggle");
    await vscode.commands.executeCommand("rpgClSupport.sosi.toggle");

    assert.equal(document.getText(), text);
  });
});
