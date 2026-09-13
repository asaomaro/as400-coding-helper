import * as vscode from "vscode";
import {
  createIbmiSourceTransport,
  IbmiSourceSyncError,
  type IbmiAuthMethod,
  type IbmiSourceSyncSettings,
  type IbmiSourceTransport
} from "../../sync/ibmiSourceTransport";
import { resolveMemberTarget, type MemberTarget } from "../../sync/memberTarget";
import { visibleToWire, wireToVisible } from "../../sync/visibleColorMarkers";
import { isInScopeDocument } from "../../utils/fileScope";
import { logError, logInfo, logWarning, showOutput } from "../outputLogger";

export const IBMI_SOURCE_SYNC_SECRET_KEY = "rpgClSupport.ibmiSourceSync.authentication";

type TransportFactory = (
  settings: IbmiSourceSyncSettings,
  authenticationSecret: string | undefined
) => Promise<IbmiSourceTransport>;

const inFlightUris = new Set<string>();

export function registerMemberSyncCommands(
  context: vscode.ExtensionContext,
  transportFactory: TransportFactory = createIbmiSourceTransport
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("rpgClSupport.ibmiSourceSync.upload", async () => {
      await runTransfer(context, "upload", transportFactory);
    }),
    vscode.commands.registerCommand("rpgClSupport.ibmiSourceSync.download", async () => {
      await runTransfer(context, "download", transportFactory);
    }),
    vscode.commands.registerCommand("rpgClSupport.ibmiSourceSync.setAuthenticationSecret", async () => {
      logInfo("IBM i 同期の認証情報保存を開始しました。");
      await setAuthenticationSecret(context);
    }),
    vscode.commands.registerCommand("rpgClSupport.ibmiSourceSync.clearAuthenticationSecret", async () => {
      await context.secrets.delete(IBMI_SOURCE_SYNC_SECRET_KEY);
      logInfo("IBM i 同期の保存済み認証情報を削除しました。");
      await vscode.window.showInformationMessage("IBM i 同期の保存済み認証情報を削除しました。");
    })
  );
}

async function runTransfer(
  context: vscode.ExtensionContext,
  direction: "upload" | "download",
  transportFactory: TransportFactory
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isInScopeDocument(editor.document)) {
    logWarning("IBM i 同期を対象外の文書で実行しました。");
    await vscode.window.showErrorMessage("IBM i 同期は対象の固定長ソースを開いて実行してください。");
    return;
  }

  const { document } = editor;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    logWarning("IBM i 同期をワークスペース外の文書で実行しました。", { document: document.uri.toString() });
    await vscode.window.showErrorMessage("IBM i 同期するファイルをワークスペース内で開いてください。");
    return;
  }
  const target = resolveMemberTarget(vscode.workspace.asRelativePath(document.uri, false));
  if (!target) {
    logWarning("IBM i 同期のパスを source member として解決できませんでした。", {
      document: vscode.workspace.asRelativePath(document.uri, false)
    });
    await vscode.window.showErrorMessage(
      "IBM i 同期の対象は src/<LIB>/<SRCFILE>/<MEMBER>.<ext> 形式のファイルです。"
    );
    return;
  }

  const uriKey = document.uri.toString();
  if (inFlightUris.has(uriKey)) {
    logWarning("IBM i 同期を実行中の文書で再実行しました。", { direction, target: targetLabel(target) });
    await vscode.window.showErrorMessage("この文書はすでに IBM i と同期中です。");
    return;
  }

  const snapshot = {
    document,
    viewColumn: editor.viewColumn,
    selection: new vscode.Selection(editor.selection.start, editor.selection.end)
  };
  inFlightUris.add(uriKey);
  let transport: IbmiSourceTransport | undefined;
  logInfo("IBM i source member 同期を開始しました。", { direction, target: targetLabel(target) });
  try {
    const settings = readSettings();
    const authenticationSecret = await context.secrets.get(IBMI_SOURCE_SYNC_SECRET_KEY);
    if (settings.authMethod === "password" && !authenticationSecret) {
      throw new IbmiSourceSyncError(
        "configuration",
        "IBM i 同期のパスワードを「認証情報を保存」で登録してください。"
      );
    }
    logInfo("IBM i への SSH 接続を開始します。", {
      host: settings.host,
      port: settings.port,
      user: settings.user,
      authMethod: settings.authMethod
    });
    transport = await transportFactory(settings, authenticationSecret);
    logInfo("IBM i への SSH 接続が確立しました。", { direction, target: targetLabel(target) });

    if (direction === "upload") {
      const wireText = normalizeToLf(visibleToWire(snapshot.document.getText()));
      logInfo("IBM i source member へアップロードします。", {
        target: targetLabel(target),
        bytes: Buffer.byteLength(wireText, "utf8")
      });
      await transport.upload(target, wireText);
      logInfo("IBM i source member へのアップロードが完了しました。", { target: targetLabel(target) });
      void vscode.window.showInformationMessage("IBM i の source member へアップロードしました。");
    } else {
      logInfo("IBM i source member からダウンロードします。", { target: targetLabel(target) });
      const wireText = await transport.download(target);
      const visibleText = normalizeToDocumentEol(wireToVisible(wireText), snapshot.document.eol);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(snapshot.document.uri, fullDocumentRange(snapshot.document), visibleText);
      if (!await vscode.workspace.applyEdit(edit)) {
        throw new IbmiSourceSyncError("transfer", "ダウンロードした内容を VS Code 文書へ適用できませんでした。");
      }
      if (!await snapshot.document.save()) {
        throw new IbmiSourceSyncError("transfer", "ダウンロードした内容をローカルファイルへ保存できませんでした。");
      }
      logInfo("IBM i source member からのダウンロードが完了しました。", {
        target: targetLabel(target),
        bytes: Buffer.byteLength(wireText, "utf8")
      });
      void vscode.window.showInformationMessage("IBM i の source member からダウンロードしました。");
    }
  } catch (error) {
    logError("IBM i source member 同期に失敗しました", error, {
      direction,
      target: targetLabel(target)
    });
    showOutput();
    // 通知の dismissal を待つと finally が遅れ、同じ文書の次の明示操作を二重実行と誤判定する。
    void vscode.window.showErrorMessage(toUserMessage(error));
  } finally {
    transport?.dispose();
    inFlightUris.delete(uriKey);
    await vscode.window.showTextDocument(snapshot.document, {
      viewColumn: snapshot.viewColumn,
      selection: snapshot.selection
    });
  }
}

function targetLabel(target: MemberTarget): string {
  return `${target.library}/${target.sourceFile}/${target.member}`;
}

function readSettings(): IbmiSourceSyncSettings {
  const configuration = vscode.workspace.getConfiguration("rpgClSupport.ibmiSourceSync");
  const authMethod = configuration.get<string>("authMethod", "password");
  if (authMethod !== "password" && authMethod !== "privateKey") {
    throw new IbmiSourceSyncError("configuration", "IBM i 同期の authMethod は password または privateKey にしてください。");
  }
  return {
    host: configuration.get<string>("host", "") ?? "",
    port: configuration.get<number>("port", 22) ?? 22,
    user: configuration.get<string>("user", "") ?? "",
    authMethod: authMethod satisfies IbmiAuthMethod,
    privateKeyPath: configuration.get<string>("privateKeyPath", "") || undefined,
    ifsTempDirectory: configuration.get<string>("ifsTempDirectory", "") ?? "",
    hostKeySha256: configuration.get<string>("hostKeySha256", "") ?? ""
  };
}

async function setAuthenticationSecret(context: vscode.ExtensionContext): Promise<void> {
  const authMethod = vscode.workspace
    .getConfiguration("rpgClSupport.ibmiSourceSync")
    .get<string>("authMethod", "password");
  const value = await vscode.window.showInputBox({
    password: true,
    prompt: authMethod === "privateKey" ? "IBM i 同期用の秘密鍵パスフレーズ" : "IBM i 同期用のパスワード",
    ignoreFocusOut: true
  });
  if (value === undefined) {
    return;
  }
  await context.secrets.store(IBMI_SOURCE_SYNC_SECRET_KEY, value);
  await vscode.window.showInformationMessage("IBM i 同期の認証情報を安全に保存しました。");
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const finalLine = document.lineAt(document.lineCount - 1);
  return new vscode.Range(0, 0, document.lineCount - 1, finalLine.text.length);
}

function normalizeToLf(text: string): string {
  return text.replace(/\r\n|\r|\n/gu, "\n");
}

function normalizeToDocumentEol(text: string, eol: vscode.EndOfLine): string {
  const lfText = normalizeToLf(text);
  return eol === vscode.EndOfLine.CRLF ? lfText.replace(/\n/gu, "\r\n") : lfText;
}

function toUserMessage(error: unknown): string {
  if (error instanceof IbmiSourceSyncError) {
    return error.message;
  }
  return "IBM i 同期に失敗しました。接続設定とネットワークを確認してください。";
}
