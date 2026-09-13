import * as assert from "assert";
import * as vscode from "vscode";
import {
  OUTPUT_CHANNEL_NAME,
  initializeOutputLogger,
  logError,
  logInfo,
  showOutput
} from "../../src/extension/outputLogger";

suite("拡張機能の Output ログ", () => {
  test("処理結果と失敗詳細を専用 Output チャネルへ記録し、明示的に表示できる", () => {
    const stub = vscode as unknown as any;
    stub.window.outputChannels = [];
    const context = { subscriptions: [] as { dispose(): void }[] } as unknown as vscode.ExtensionContext;

    initializeOutputLogger(context);
    logInfo("同期を開始しました。", { target: "ASAOLIB/QRPGSRC/RPG3SAMP" });
    logError("同期に失敗しました", new Error("CPF0001: テスト用エラー"));
    showOutput();

    const channel = stub.window.outputChannels[0];
    assert.equal(channel.name, OUTPUT_CHANNEL_NAME);
    assert.ok(channel.lines.some((line: string) => line.includes("[INFO] 同期を開始しました。")));
    assert.ok(channel.lines.some((line: string) => line.includes("[ERROR] 同期に失敗しました: CPF0001: テスト用エラー")));
    assert.deepEqual(channel.showCalls, [true]);

    for (const disposable of context.subscriptions) {
      disposable.dispose();
    }
  });
});
