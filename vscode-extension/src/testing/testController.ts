import * as vscode from "vscode";
import { discoverTestFiles, type DiscoveredTestFile } from "./discovery";
import { connectViaCodeForIbmi, type ConnectResult, type IbmiTestingConnection, type ConnectFailureReason } from "./codeForIbmi";
import { buildCreateTestCommand, buildRunTestCommand } from "./rpgunitCommands";
import { parseJUnitXml } from "./resultParser";
import { deriveSourceType } from "../sync/memberTarget";

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

async function readSourceText(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf8");
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

  const source = await readSourceText(fileItem.uri!);
  await connection.uploadMemberContent(discovered.target, source);
  // アップロード（CPYFRMSTMF相当）だけではSRCTYPE属性が付かない。RUCRTRPGは
  // getMemberType()でメンバーのSRCTYPEを見て分岐するため、別途設定が必須
  // （`.claude/skills/ibmi-remote/SKILL.md`「ソースタイプは別途設定する」）。
  await connection.runCommand(
    `CHGPFM FILE(${discovered.target.library}/${discovered.target.sourceFile}) ` +
    `MBR(${discovered.target.member}) SRCTYPE(${deriveSourceType(discovered.target.extension)})`
  );

  const createCommand = buildCreateTestCommand({
    library: discovered.target.library,
    program: discovered.target.member,
    sourceFile: discovered.target.sourceFile
  });
  // 実機確認（T1）でRUCRTRPGは約1.4秒と判明し、同期runCommandをデフォルトにしている
  // （decisions.md D4）。大規模テストで同期実行がタイムアウトする場合は、ここを
  // `connection.runCommandSubmitted(createCommand, {...})`（SBMJOB＋ポーリング）に
  // 差し替える（decisions.md D2）。
  const createResult = await connection.runCommand(createCommand);
  // RUCRTRPG が作るテストオブジェクトは *SRVPGM（*PGM ではない。実機確認済み。decisions.md D4追記）。
  const compiled = await connection.checkObjectExists({
    library: discovered.target.library,
    name: discovered.target.member,
    type: "*SRVPGM"
  });
  if (!compiled) {
    const detail = createResult.stderr || createResult.stdout || "(詳細なし)";
    const message = new vscode.TestMessage(`コンパイルに失敗しました。\n${detail}`);
    for (const child of children) {
      run.errored(child, message);
    }
    return;
  }

  const xmlPath = `${connection.tempDirectory}/${discovered.target.member}.xml`;
  await connection.runCommand(
    buildRunTestCommand({ library: discovered.target.library, program: discovered.target.member, xmlStmf: xmlPath })
  );

  let xml: string;
  try {
    xml = await connection.downloadStreamfile(xmlPath);
  } catch (error) {
    const message = new vscode.TestMessage(`結果を取得できませんでした: ${String((error as Error)?.message ?? error)}`);
    for (const child of children) {
      run.errored(child, message);
    }
    return;
  } finally {
    await connection.runCommand(`QSYS/RMVLNK OBJLNK('${xmlPath}')`).catch(() => undefined);
  }

  const suite = parseJUnitXml(xml);
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
    await runFile(run, connectResult.connection, target);
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
