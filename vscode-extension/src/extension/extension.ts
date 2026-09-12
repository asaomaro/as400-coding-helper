import * as vscode from "vscode";
import { registerLanguageFeatures } from "../language/registration";
import { registerShowPrompterCommand } from "./commands/showPrompter";
import { registerMemberSyncCommands } from "./commands/memberSync";
import { registerSeuColorMarkers } from "../language/seuColorMarkers";

export function activate(context: vscode.ExtensionContext): void {
  registerLanguageFeatures(context);
  registerShowPrompterCommand(context);
  registerMemberSyncCommands(context);
  registerSeuColorMarkers(context);
}

export function deactivate(): void {
  // No-op for now
}
