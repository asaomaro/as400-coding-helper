import * as vscode from "vscode";
import { findTestingConfigs, type ReadOutcome, type TestingConfigSource } from "./testingConfigCore";

/**
 * VS Code のワークスペースから `testing.json` を探して読む薄い層。探し方・解釈は `testingConfigCore.ts`。
 * ワークスペースフォルダーに属さないファイルでは何も読まない。
 */
export async function readTestingConfigs(
  fileUri: vscode.Uri
): Promise<{ nearest?: TestingConfigSource; global?: TestingConfigSource }> {
  const folder = vscode.workspace.getWorkspaceFolder(fileUri);
  if (!folder) {
    return {};
  }
  const toUri = (file: string) => fileUri.with({ path: file });
  const read = async (file: string): Promise<ReadOutcome> => {
    const uri = toUri(file);
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      return { kind: "missing" };
    }
    if ((stat.type & vscode.FileType.Directory) !== 0) {
      return { kind: "directory" };
    }
    try {
      return { kind: "text", text: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8") };
    } catch (error) {
      return { kind: "error", message: String((error as Error)?.message ?? error) };
    }
  };
  return findTestingConfigs(fileUri.path, folder.uri.path, read, file => vscode.workspace.asRelativePath(toUri(file), false));
}
