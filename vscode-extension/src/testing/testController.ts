import * as vscode from "vscode";
import { discoverTestFiles, type DiscoveredTestFile } from "./discovery";
import { connectViaCodeForIbmi, type ConnectResult, type IbmiTestingConnection, type ConnectFailureReason } from "./codeForIbmi";
import { compileSuite, runSuite } from "./suiteRunner";
import { readTestingConfigs } from "./testingConfig";
import { resolveBinding } from "./testingConfigCore";

const CONTROLLER_ID = "rpgClSupport.rpgunit";
const CONTROLLER_LABEL = "RPGUnit";

function connectFailureMessage(reason: ConnectFailureReason): string {
  switch (reason) {
    case "notInstalled":
      return "Code for IBM i拡張機能が必要です。インストールしてください。";
    case "notConnected":
      return "IBM iへの接続が必要です。Code for IBM iで接続してください。";
    case "incompatibleApi":
      return "Code for IBM iのAPIが想定と異なります（バージョン不一致の可能性があります）。";
    default:
      return "IBM iへ接続できませんでした。";
  }
}

interface RunTarget {
  readonly fileItem: vscode.TestItem;
  readonly discovered: DiscoveredTestFile;
}

function collectRequestedFiles(
  controller: vscode.TestController,
  fileItems: ReadonlyMap<string, DiscoveredTestFile>,
  request: vscode.TestRunRequest
): readonly RunTarget[] {
  const included: vscode.TestItem[] = [];
  if (request.include) {
    included.push(...request.include);
  } else {
    controller.items.forEach(item => included.push(item));
  }
  const excluded = new Set((request.exclude ?? []).map(item => item.id));

  const byFileId = new Map<string, RunTarget>();
  for (const item of included) {
    const fileItem = item.parent ?? item;
    if (excluded.has(fileItem.id)) {
      continue;
    }
    const discovered = fileItems.get(fileItem.id);
    if (discovered) {
      byFileId.set(fileItem.id, { fileItem, discovered });
    }
  }
  return [...byFileId.values()];
}

/** 開いているエディターがあれば未保存の内容を優先する（利用者が見ているものを試す）。 */
async function readSourceText(uri: vscode.Uri): Promise<string> {
  const open = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
  if (open) {
    return open.getText();
  }
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf8");
}

function erroredAll(run: vscode.TestRun, children: readonly vscode.TestItem[], text: string): void {
  const message = new vscode.TestMessage(text);
  for (const child of children) {
    run.errored(child, message);
  }
}

async function runFile(
  run: vscode.TestRun,
  connection: IbmiTestingConnection,
  target: RunTarget
): Promise<void> {
  const { fileItem, discovered } = target;
  const children = [...fileItem.children].map(([, child]) => child);
  for (const child of children) {
    run.started(child);
  }

  // バインド指定（testing.json）はアップロードより前に確かめる。誤っていればコンパイルしない。
  const configs = await readTestingConfigs(fileItem.uri!);
  const binding = resolveBinding(configs.nearest, configs.global);
  if (!binding.ok) {
    erroredAll(run, children, `testing.json の設定が正しくありません: ${binding.path}\n${binding.reason}`);
    return;
  }

  const source = await readSourceText(fileItem.uri!);
  // 実機確認で RUCRTRPG は 1〜2 秒と判明し、同期実行を既定にしている
  // （`.aidev/works/20260922-rpgunit-vscode-testing/decisions.md` D4）。大規模テストで同期実行が
  // タイムアウトする場合の切り替え先は `connection.runCommandSubmitted`（同 D2）。
  const compiled = await compileSuite(connection, { target: discovered.target, source, binding: binding.binding });
  if (!compiled.ok) {
    erroredAll(run, children, `コンパイルに失敗しました。\n${compiled.detail}`);
    return;
  }
  const ran = await runSuite(connection, { target: discovered.target });
  if (!ran.ok) {
    erroredAll(run, children, ran.detail);
    return;
  }
  const suite = ran.suite;
  const childByName = new Map(children.map(child => [child.label.toUpperCase(), child]));
  for (const testCase of suite.cases) {
    const child = childByName.get(testCase.name.toUpperCase());
    if (!child) {
      continue;
    }
    if (testCase.failure) {
      const message = new vscode.TestMessage(testCase.failure.message || testCase.failure.detail);
      if (child.uri && child.range) {
        message.location = new vscode.Location(child.uri, child.range.start);
      }
      run.failed(child, message);
    } else {
      run.passed(child);
    }
  }
}

async function runHandler(
  controller: vscode.TestController,
  fileItems: ReadonlyMap<string, DiscoveredTestFile>,
  connectFn: () => Promise<ConnectResult>,
  request: vscode.TestRunRequest,
  token: vscode.CancellationToken
): Promise<void> {
  const run = controller.createTestRun(request);
  const targets = collectRequestedFiles(controller, fileItems, request);
  for (const { fileItem } of targets) {
    for (const [, child] of fileItem.children) {
      run.enqueued(child);
    }
  }

  const connectResult = await connectFn();
  if (!connectResult.ok) {
    const message = new vscode.TestMessage(connectFailureMessage(connectResult.reason));
    for (const { fileItem } of targets) {
      for (const [, child] of fileItem.children) {
        run.errored(child, message);
      }
    }
    run.end();
    return;
  }

  for (const target of targets) {
    if (token.isCancellationRequested) {
      for (const [, child] of target.fileItem.children) {
        run.skipped(child);
      }
      continue;
    }
    try {
      await runFile(run, connectResult.connection, target);
    } catch (error) {
      // 例外で抜けると run.end() に届かず、テストが実行中のまま残る。
      erroredAll(
        run,
        [...target.fileItem.children].map(([, child]) => child),
        `実行中にエラーが発生しました: ${String((error as Error)?.message ?? error)}`
      );
    }
  }

  run.end();
}

export function registerRpgUnitTesting(
  context: vscode.ExtensionContext,
  connectFn: () => Promise<ConnectResult> = connectViaCodeForIbmi
): void {
  const controller = vscode.tests.createTestController(CONTROLLER_ID, CONTROLLER_LABEL);
  context.subscriptions.push(controller);

  const fileItems = new Map<string, DiscoveredTestFile>();

  const refresh = async (): Promise<void> => {
    controller.items.replace([]);
    fileItems.clear();
    const folders = vscode.workspace.workspaceFolders ?? [];
    const files = await discoverTestFiles(folders);
    for (const file of files) {
      const fileItem = controller.createTestItem(file.uri.toString(), file.target.member, file.uri);
      fileItems.set(fileItem.id, file);
      for (const procedure of file.procedures) {
        const procedureItem = controller.createTestItem(
          `${file.uri.toString()}#${procedure.name}`,
          procedure.name,
          file.uri
        );
        procedureItem.range = new vscode.Range(procedure.line, 0, procedure.line, 0);
        fileItem.children.add(procedureItem);
      }
      controller.items.add(fileItem);
    }
  };

  controller.resolveHandler = async () => {
    await refresh();
  };
  controller.refreshHandler = async () => {
    await refresh();
  };

  controller.createRunProfile(
    "Run",
    vscode.TestRunProfileKind.Run,
    (request, token) => runHandler(controller, fileItems, connectFn, request, token),
    true
  );
}
