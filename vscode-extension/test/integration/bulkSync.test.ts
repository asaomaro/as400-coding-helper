import { strict as assert } from "node:assert";
import * as vscode from "vscode";

/**
 * ソース・ファイル単位の送受信が**本物の VS Code に登録されている**ことを見る。
 * 画面の中身は `dev/sync-e2e.mjs`、突き合わせと転送はユニットテストが見る。ここは器（登録）だけ。
 */
suite("IBM i 一括の送受信 Integration", () => {
  test("コマンドが登録されている（パレットとフォルダの右クリックの両方がこれを呼ぶ）", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("rpgClSupport.ibmiSourceSync.openBulk"));
  });
});
