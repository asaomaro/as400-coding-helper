import * as vscode from "vscode";
import { registerLanguageFeatures } from "../language/registration";
import { registerShowPrompterCommand } from "./commands/showPrompter";
import { registerMemberSyncCommands } from "./commands/memberSync";
import { registerSeuColorMarkers } from "../language/seuColorMarkers";
import { initializeOutputLogger, logInfo, showOutput } from "./outputLogger";

export function activate(context: vscode.ExtensionContext): void {
  initializeOutputLogger(context);
  context.subscriptions.push(
    vscode.commands.registerCommand("rpgClSupport.showOutput", () => {
      logInfo("出力パネルを表示しました。");
      showOutput();
    })
  );
  registerLanguageFeatures(context);
  logInfo("言語支援機能を登録しました。");
  registerShowPrompterCommand(context);
  logInfo("F4 プロンプターを登録しました。");
  registerMemberSyncCommands(context);
  logInfo("IBM i source member 同期コマンドを登録しました。");
  registerSeuColorMarkers(context);
  logInfo("SEU 色 marker 表示を登録しました。");
}

export function deactivate(): void {
  // No-op for now
}
