import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  try {
    // このファイルの出力先は out-test/test/ なので、
    // 拡張のルート（vscode-extension/）は 2 つ上になる。
    const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
    const extensionTestsPath = path.resolve(__dirname, "suite");

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to run tests", err);
    process.exit(1);
  }
}

void main();
