import * as vscode from "vscode";
import { discoverTestFiles, isDiscoveredStreamTest, type DiscoveredStreamTestFile, type DiscoveredTestFile } from "./discovery";
import {
  connectViaCodeForIbmi, type ConnectResult, type IbmiTestingConnection, type ConnectFailureReason, type DeployOutcome
} from "./codeForIbmi";
import { compileStreamSuite, compileSuite, runSuite, type TestProgram } from "./suiteRunner";
import { readTestingConfigs } from "./testingConfig";
import { resolveBinding, type BindingSpec } from "./testingConfigCore";

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

function deployFailureMessage(reason: "notConfigured" | "failed" | "unavailable"): string {
  switch (reason) {
    case "notConfigured":
      return "Code for IBM iのデプロイ先が設定されていません。エクスプローラーでワークスペースのフォルダーを右クリックし" +
        "「Deploy Location」を設定してから実行してください。IFS方式（*.test.rpgle）のテストは、デプロイしたIFSのソースからコンパイルします。";
    case "failed":
      return "Code for IBM iのデプロイに失敗しました。出力パネルのCode for IBM iのデプロイのログを確認してください。";
    case "unavailable":
      return "Code for IBM iのデプロイAPIが見つかりません（バージョン不一致の可能性があります）。";
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

/**
 * IFS 方式のファイルが属するワークスペース・フォルダー（デプロイの単位）の鍵。検出はワークスペース・フォルダーの中しか
 * 探さない（`discoverTestFiles`）ので、フォルダーが無いことは実際には起きない（起きたら未設定と同じ扱いにする）。
 */
function folderKey(uri: vscode.Uri): string {
  return vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() ?? "";
}

/**
 * IFS 方式の実行の前に、要求されたファイルが属するワークスペース・フォルダーを 1 回ずつデプロイする
 * （`.aidev/works/20260926-rpgunit-ifs-deploy/decisions.md` D4・D5）。
 */
async function deployFolders(
  connection: IbmiTestingConnection,
  targets: readonly RunTarget[]
): Promise<ReadonlyMap<string, DeployOutcome>> {
  const deployments = new Map<string, DeployOutcome>();
  for (const { discovered } of targets) {
    if (!isDiscoveredStreamTest(discovered)) {
      continue;
    }
    const key = folderKey(discovered.uri);
    if (deployments.has(key)) {
      continue;
    }
    const folder = vscode.workspace.getWorkspaceFolder(discovered.uri);
    try {
      deployments.set(key, folder ? await connection.deploy(folder) : { ok: false, reason: "notConfigured" });
    } catch {
      // 例外で抜けると run.end() に届かず、同じ実行のメンバー方式のテストも走らない
      deployments.set(key, { ok: false, reason: "failed" });
    }
  }
  return deployments;
}

/** IFS 方式のコンパイル。失敗なら errored にして false。 */
async function compileStream(
  run: vscode.TestRun,
  connection: IbmiTestingConnection,
  discovered: DiscoveredStreamTestFile,
  children: readonly vscode.TestItem[],
  deployments: ReadonlyMap<string, DeployOutcome>,
  binding: BindingSpec
): Promise<TestProgram | undefined> {
  const deployed = deployments.get(folderKey(discovered.uri)) ?? { ok: false, reason: "notConfigured" };
  if (!deployed.ok) {
    erroredAll(run, children, deployFailureMessage(deployed.reason));
    return undefined;
  }
  const name = discovered.stream.program;
  if (!name) {
    const fileName = discovered.stream.relativePath.slice(discovered.stream.relativePath.lastIndexOf("/") + 1);
    erroredAll(run, children,
      `ファイル名 ${fileName} からIBM iのプログラム名を作れません（10文字以内・英数字と _ $ # @）。ファイル名を変えてください。`);
    return undefined;
  }
  if (!connection.currentLibrary) {
    erroredAll(run, children,
      "Code for IBM iの接続設定に現行ライブラリーがありません。テスト・プログラムを作るライブラリーとして現行ライブラリーを設定してください。");
    return undefined;
  }
  const program = { library: connection.currentLibrary, program: name };
  // IFS 方式はデプロイしたディスク上のファイルをコンパイルする（開いているエディターの未保存の内容は使わない）。
  const compiled = await compileStreamSuite(connection, {
    program, target: discovered.stream, deployRoot: deployed.remoteDirectory, binding
  });
  if (!compiled.ok) {
    erroredAll(run, children, compiled.stage === "convert"
      ? `${compiled.detail}\nCode for IBM iのデプロイ先にこのファイルがデプロイされているか確認してください。`
      : `コンパイルに失敗しました。\n${compiled.detail}`);
    return undefined;
  }
  return program;
}

async function runFile(
  run: vscode.TestRun,
  connection: IbmiTestingConnection,
  target: RunTarget,
  deployments: ReadonlyMap<string, DeployOutcome>
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

  let program: TestProgram;
  if (isDiscoveredStreamTest(discovered)) {
    const compiled = await compileStream(run, connection, discovered, children, deployments, binding.binding);
    if (!compiled) {
      return;
    }
    program = compiled;
  } else {
    const source = await readSourceText(fileItem.uri!);
    // 実機確認で RUCRTRPG は 1〜2 秒と判明し、同期実行を既定にしている
    // （`.aidev/works/20260922-rpgunit-vscode-testing/decisions.md` D4）。大規模テストで同期実行が
    // タイムアウトする場合の切り替え先は `connection.runCommandSubmitted`（同 D2）。
    const compiled = await compileSuite(connection, { target: discovered.target, source, binding: binding.binding });
    if (!compiled.ok) {
      erroredAll(run, children, `コンパイルに失敗しました。\n${compiled.detail}`);
      return;
    }
    program = { library: discovered.target.library, program: discovered.target.member };
  }
  const ran = await runSuite(connection, { program });
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

  const deployments = token.isCancellationRequested
    ? new Map<string, DeployOutcome>()
    : await deployFolders(connectResult.connection, targets);

  for (const target of targets) {
    if (token.isCancellationRequested) {
      for (const [, child] of target.fileItem.children) {
        run.skipped(child);
      }
      continue;
    }
    try {
      await runFile(run, connectResult.connection, target, deployments);
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
      const fileItem = isDiscoveredStreamTest(file)
        ? controller.createTestItem(file.uri.toString(), file.uri.path.slice(file.uri.path.lastIndexOf("/") + 1), file.uri)
        : controller.createTestItem(file.uri.toString(), file.target.member, file.uri);
      if (isDiscoveredStreamTest(file)) {
        fileItem.description = file.stream.program ?? "プログラム名を作れません";
      }
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
