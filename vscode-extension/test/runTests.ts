import * as path from "node:path";
import { runTests } from "vscode-test";

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "..");
    const extensionTestsPath = path.resolve(__dirname, "./suite");

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

